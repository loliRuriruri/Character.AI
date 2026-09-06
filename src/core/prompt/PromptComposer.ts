import type { ChatMessage } from "../../shared/types";
import type {
  CharacterMode,
  CharacterProfile,
  ContextProfile,
  ConversationMemory,
  PersonaProfile,
  PromptBlock,
  SceneState,
} from "../character/types";

export interface PromptComposeOptions {
  character: CharacterProfile;
  persona: PersonaProfile;
  context: ContextProfile;
  sceneState?: SceneState;
  memory?: ConversationMemory;
  mode: CharacterMode;
  authorNote?: string;
}

export interface ComposeChatMessagesOptions extends PromptComposeOptions {
  recentMessages: ChatMessage[];
  provider?: string;
}

export class PromptComposer {
  /**
   * 우선순위 기반 프롬프트 블록 리스트 생성
   * (시스템 프롬프트 내 순서: Base -> Character -> Persona -> Context -> Scene -> Memory -> Mode -> AuthorNote)
   */
  static composeBlocks(opts: PromptComposeOptions): PromptBlock[] {
    const blocks: PromptBlock[] = [];

    // 1. [Priority 100] 기본 행동 제약 및 언어 규칙
    blocks.push({
      id: "base_constraints",
      priority: 100,
      content: [
        `[기본 지침]`,
        `- 너는 ${opts.character.name}이다. 항상 캐릭터로서 대화하며 인공지능이나 언어모델임을 밝히지 않는다.`,
        `- [음성 대화 분량 규칙] 실제 사람과 실시간 음성으로 주고받는 자연스러운 일상 대화이므로, 절대 백과사전식 설명문, 보고서, 긴 요약을 작성하지 않는다. 1~3문장 내외의 간결하고 친근한 구어체로 답하며, 자연스럽게 상대방에게 되물으며 티키타카를 이어간다.`,
        `- [문서 서식 절대 금지] 마크다운 제목(#, ##, ###), 글머리 기호(-, •), 번호 매기기(1., 2.), 수평 구분선(---, ***), '특징:', '추가 정보:', 목차 등을 절대 출력하지 않는다. 오직 사람이 입으로 발화하는 친근한 대화 문장으로만 말한다.`,
        `- [발화 대사 vs 신체 행동 묘사 분리]`,
        `  • 캐릭터 본인의 신체 행동 묘사, 제스처, 표정, 또는 짧은 속마음만 반드시 *별표(이탤릭)*로 감싸서 작성한다. (예: *살며시 고개를 끄덕인다.*, *눈을 반짝이며 미소 짓는다.*)`,
        `  • 퀴즈 문제, 질문, 보기(①②③④), 인용문, 예문은 소리 내어 말하는 실제 발화 대사이므로 절대로 별표(*...*)로 감싸지 않는다.`,
        `  • 소리 내어 말하는 실제 발화 대사만 별표 바깥에 작성한다. 행동 묘사나 생각 서술을 대사 안에 섞어서 말하지 않는다.`,
        `- [메타 주석 및 구분선 금지] 수평선(---), 메타 해설 주석([3문항만 출제], [생각:])은 절대 출력하지 않는다.`,
        `- 생각 과정(<think> 태그나 내부 추론)은 절대 출력하지 않으며, 오직 한국어 대사와 행동 서술만 즉시 출력한다.`,
        `- [언어 절대 준수 (Zero Chinese Rule)] 너는 한국인 마스터와 대화하는 캐릭터이다. 모든 대사, 질문, 보기, 행동 서술은 100% 한국어(일본어 회화 학습 질문 시 일본어 단어/예문 제외)로만 작성한다. 중국어(간체자/번체자 한자 문장, 예: 你喜欢吗, 什么, 很好 등)는 단 한 글자도 절대로 출력해서는 안 된다! 사물이나 음식 이름도 중국어가 아닌 순수 한국어나 외래어로만 쓴다 (예: 芒果 대신 망고, 面包 대신 빵).`,
        `- 문장 부호(?, !, .) 뒤에는 반드시 한 칸 띄어쓰기를 하여 자연스러운 발화 호흡을 지킨다.`,
        `- 느낌표(!)를 연속 남발하지 않고 부드러운 말끝(~, .)을 자연스럽게 쓴다.`,
        `- [일관된 밝은 톤 유지] 특정 문장에서 목소리 톤이 어둡거나 침착하게 가라앉지 않도록 주의한다. 마스터를 위로하거나 공감할 때도 나지막한 독백 어조(~했을 거야.) 대신 다정하고 생기 있는 구어체(~했구나~, ~했겠네!)로 발화하여 항상 밝고 사랑스러운 에너지를 전달한다.`,
        opts.character.speakingStyle.forbiddenWords.length > 0
          ? `- 다음 표현은 사용하지 않는다: ${opts.character.speakingStyle.forbiddenWords.join(", ")}`
          : "",
      ].filter(Boolean).join("\n"),
    });

    // 2. [Priority 90] 캐릭터 프로필
    const charExamples = (opts.character.exampleDialogues || [])
      .map(d => `User: ${d.user}\n${opts.character.name}: ${d.assistant}`)
      .join("\n\n");

    blocks.push({
      id: "character_profile",
      priority: 90,
      content: [
        `[캐릭터 프로필: ${opts.character.name}]`,
        `- 호칭/역할: ${opts.character.title}`,
        `- 성격 및 특징: ${opts.character.description} ${opts.character.personality.join(", ")}`,
        `- 기본 시나리오: ${opts.character.scenario}`,
        `- 말투 및 발화 스타일: ${opts.character.speakingStyle.tone}`,
        charExamples ? `\n<대화 예시>\n${charExamples}` : "",
      ].filter(Boolean).join("\n"),
    });

    // 3. [Priority 80] 사용자 페르소나
    blocks.push({
      id: "persona_profile",
      priority: 80,
      content: [
        `[대화 상대 페르소나]`,
        `- 이름: ${opts.persona.userName}`,
        `- 상대방을 부르는 호칭: ${opts.persona.callName}`,
        `- 둘 사이의 관계: ${opts.persona.relationship}`,
        `- 성향 및 특징: ${opts.persona.traits.join(", ")}`,
        `- 선호 언어: ${opts.persona.languagePreference.toUpperCase()}`,
      ].join("\n"),
    });

    // 4. [Priority 70] 공간 및 세계관 컨텍스트
    blocks.push({
      id: "context_profile",
      priority: 70,
      content: [
        `[공간 및 환경 맥락]`,
        `- 세계/배경: ${opts.context.worldName}`,
        `- 현재 장소: ${opts.context.location}`,
        `- 환경 묘사: ${opts.context.environmentLore}`,
      ].join("\n"),
    });

    // 5. [Priority 60] 3D 씬 상태 (자세, 감정, 분위기)
    if (opts.sceneState) {
      blocks.push({
        id: "scene_state",
        priority: 60,
        content: [
          `[현재 씬 상태 (Scene State)]`,
          `- 현재 위치: ${opts.sceneState.location}`,
          `- 시간대: ${opts.sceneState.timePeriod}`,
          `- 캐릭터 감정: ${opts.sceneState.characterEmotion}`,
          `- 자세/동작: ${opts.sceneState.posture}`,
          `- 시선 방향: ${opts.sceneState.gazeTarget}`,
          `- 에너지/텐션: ${(opts.sceneState.energyLevel * 100).toFixed(0)}%`,
        ].join("\n"),
      });
    }

    // 6. [Priority 50] 장기 기억 및 누적 롤링 요약
    if (opts.memory) {
      const memoryLines: string[] = ["[대화 기억 및 요약 (Memory)]"];
      if (opts.memory.rollingSummary?.trim()) {
        memoryLines.push(`- 이전 대화 요약:\n${opts.memory.rollingSummary.trim()}`);
      }
      if (opts.memory.facts && opts.memory.facts.length > 0) {
        memoryLines.push(`- 기억하고 있는 중요 사실:\n  • ${opts.memory.facts.join("\n  • ")}`);
      }
      if (opts.memory.relationshipState?.trim()) {
        memoryLines.push(`- 관계성 메모: ${opts.memory.relationshipState}`);
      }
      if (opts.memory.promises && opts.memory.promises.length > 0) {
        memoryLines.push(`- 사용자와 나눈 약속:\n  • ${opts.memory.promises.join("\n  • ")}`);
      }
      if (opts.memory.openThreads && opts.memory.openThreads.length > 0) {
        memoryLines.push(`- 진행 중인 대화 주제:\n  • ${opts.memory.openThreads.join("\n  • ")}`);
      }
      if (memoryLines.length > 1) {
        blocks.push({
          id: "conversation_memory",
          priority: 50,
          content: memoryLines.join("\n"),
        });
      }
    }

    // 7. [Priority 40] 모드별 서술 스타일 룰 (Free / RP / Tutor)
    if (opts.mode === "rp") {
      blocks.push({
        id: "mode_style_rp",
        priority: 40,
        content: [
          `[롤플레잉(RP) 모드 서술 규칙]`,
          `- 캐릭터의 신체 행동, 표정, 제스처, 시선, 상황 묘사는 반드시 *별표(이탤릭)*로 작성한다.`,
          `  예시: *살며시 고개를 끄덕이며 미소를 짓는다.*`,
          `  예시: *양손을 힘차게 흔들며 눈을 반짝인다.*`,
          `- 캐릭터가 소리 내어 말하는 실제 발화 대사는 별표 바깥에 작성하거나 "큰따옴표"로 감싼다.`,
          `  예시: *고개를 끄덕이며 웃는다.* "응, 좋아! 언제든 준비됐어."`,
          `- 행동 서술을 대사와 명확히 분리해야 캐릭터의 3D 아바타 제스처와 음성 합성이 자연스럽게 연동된다.`,
        ].join("\n"),
      });
    } else if (opts.mode === "tutor") {
      blocks.push({
        id: "mode_style_tutor",
        priority: 40,
        content: [
          `[외국어 회화 튜터 모드 규칙]`,
          `- 친절하고 똑똑한 일본어/외국어 회화 튜터로서 대화한다.`,
          `- [1문항 대화식 퀴즈 원칙 (필수)] 퀴즈나 문제를 낼 때는 반드시 한 번에 단 1문제만 출제하고 사용자의 답변을 기다린다. 절대로 Q1, Q2처럼 여러 문제를 한 번에 출제하거나 시험지처럼 나열하지 않는다.`,
          `- [정답 스포일러 및 자문자답 절대 금지!] 문제를 낸 같은 턴에서 절대로 정답(예: "정답은 1번이야!")이나 해설을 스스로 말하지 않는다. 보기를 제시한 직후 "마스터, 정답은 몇 번일까? 한번 맞춰봐~"처럼 질문을 던지고 즉시 말을 마쳐야 한다.`,
          `- [발랄하고 친근한 구어체 퀴즈 출제] 딱딱하고 건조한 시험지 문체(예: "~인 것은?", "~을 고르시오.")는 음성 톤이 차갑게 가라앉으므로 절대 쓰지 않는다. 항상 발랄하고 귀여운 구어체(예: "~인 건 몇 번일까?", "~를 뜻하는 단어는 뭘까? 골라봐~!")로 질문하여 생동감 넘치는 발랄한 톤을 유지한다.`,
          `- [퀴즈 서식 및 발화 원칙] 퀴즈 문제, 질문, 보기 번호(①, ②, ③, ④), 예문은 마스터에게 소리 내어 읽어주는 대사이므로 절대로 별표(*...*)로 감싸지 않는다. 선명한 일반 텍스트로 작성한다.`,
          `- [불필요한 서식 금지] 수평선(---), 구분 기호, 메타 주석(예: [일단 3문항만...], [참고])은 절대 출력하지 않는다.`,
          `- 4지선다 보기는 한 줄에 하나씩 명확히 줄바꿈하여 작성한다:`,
          `  ① 보기 1\n  ② 보기 2\n  ③ 보기 3\n  ④ 보기 4`,
          `- 유용한 단어는 '단어(요미가나) : 한국어 뜻' 형식으로 1~2개만 간결하게 정리한다.`,
          `- 마스터가 답을 맞히면 크게 칭찬해주고, 틀리면 친절하게 해설한 뒤 다음 문제를 낼지 물어본다.`,
          `- 틀린 문법이나 표현이 있다면 친절하게 교정해준다.`,
        ].join("\n"),
      });
    } else {
      // Free mode
      blocks.push({
        id: "mode_style_free",
        priority: 40,
        content: [
          `[자유 대화 모드 규칙]`,
          `- 친구처럼 편안하고 자연스럽게 일상 대화를 나눈다.`,
          `- 사용자가 지식이나 사실을 묻더라도(예: "~ 알아?", "~가 뭐야?") 절대 백과사전식 리포트를 쓰지 않고, 1~3문장의 생동감 있는 대화체로 핵심만 재치 있게 답한다. (예: "응, 당연히 알지! 경주마 소녀들이 달리고 노래하는 인기 게임이잖아~ 마스터도 우마무스메 좋아해?")`,
          `- 마크다운 제목(#, ##)이나 글머리표(-, •, 1., 2.), 개조식 목차는 일체 쓰지 않는다.`,
          `- 감정 표현이 필요할 때 가벼운 신체 동작(*...*)을 자연스럽게 덧붙여도 좋다.`,
        ].join("\n"),
      });
    }

    // 8. [Late High-Priority Guidance] Author's Note (시스템 프롬프트 내 최하단 배치로 Recency Effect 극대화)
    if (opts.authorNote?.trim()) {
      blocks.push({
        id: "author_note",
        priority: 10,
        content: `[Author's Note - Late High-Priority Guidance]\n${opts.authorNote.trim()}`,
      });
    }

    // 우선순위 내림차순 정렬 (높은 숫자가 상단, 낮은 숫자가 하단에 위치하여 Author's Note가 시스템 프롬프트 맨 끝에 위치)
    blocks.sort((a, b) => b.priority - a.priority);
    return blocks;
  }

  /**
   * 단일 시스템 프롬프트 문자열로 합성
   */
  static composeSystemPrompt(opts: PromptComposeOptions): string {
    const blocks = this.composeBlocks(opts);
    return blocks.map(b => b.content.trim()).filter(Boolean).join("\n\n---\n\n");
  }

  /**
   * 최종 ChatMessages 배열 구성 (Section 13 Author's Note late-injection ordering)
   * 구조:
   * 1. System Prompt (Base + Character + Persona + Context + Scene + Memory + Mode)
   * 2. Recent History Turns
   * 3. AuthorNote (Late High-Priority Guidance) -> 최근 히스토리 뒤 / 최신 사용자 메시지 직전 주입
   * 4. Latest User Message
   */
  static composeChatMessages(opts: ComposeChatMessagesOptions): ChatMessage[] {
    const note = opts.authorNote?.trim();
    // System prompt generated without authorNote if injecting late
    const baseSystemPrompt = this.composeSystemPrompt({
      ...opts,
      authorNote: undefined,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: baseSystemPrompt },
    ];

    const history = [...opts.recentMessages];
    if (history.length === 0) {
      if (note) {
        messages.push({
          role: "system",
          content: `[Author's Note - Highest Priority Guidance]\n${note}`,
        });
      }
      return messages;
    }

    // If there is history, split the latest turn from prior history
    const priorHistory = history.slice(0, -1);
    const lastMessage = history[history.length - 1];

    // Add prior history
    messages.push(...priorHistory);

    // Inject Author's Note late (just before the latest user message)
    if (note) {
      // For Ollama/Gemini/OpenAI standard: inject as late system guidance message
      messages.push({
        role: "system",
        content: `[Author's Note - Late High-Priority Guidance]\n${note}`,
      });
    }

    // Add latest user message
    messages.push(lastMessage);

    // Development Mode Logger: Role + Block ID + Ordering audit without exposing user prompt
    const isDev = typeof globalThis !== "undefined" && (globalThis as any).process?.env?.NODE_ENV !== "production";
    if (isDev) {
      const summary = messages.map((m, idx) => ({
        index: idx,
        role: m.role,
        length: m.content.length,
        isAuthorNote: m.content.includes("Author's Note"),
      }));
      console.log("[PromptComposer Order Audit]", summary);
    }

    return messages;
  }
}

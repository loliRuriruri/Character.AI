import { Ipc } from "../shared/ipc";
import type { AppSettings, VoiceCatalog, FishVoiceFavorite, CharacterVoiceProfile } from "../shared/types";

const root = document.getElementById("root")!;
root.innerHTML = `
<div id="shell">
  <header>
    <span class="title">⚙️ AI 캐릭터챗 환경설정</span>
    <button id="btn-close" type="button" class="no-drag">닫기 (X)</button>
  </header>
  <div id="content" class="no-drag">
    <!-- 1. VRM Model Switcher -->
    <div class="section">
      <div class="sec-title">
        <span>🎭 3D VRM 캐릭터 변경</span>
        <button id="btn-browse-vrm" class="btn-file" type="button">📂 내 PC에서 VRM 파일 불러오기</button>
      </div>
      <label>설치된 VRM 모델 선택
        <select id="vrmModelSelect"></select>
      </label>
      <div style="font-size:10px; color:#8aa8b0; line-height:1.4;">
        * BOOTH 등에서 다운로드한 <b>.vrm</b> 파일을 선택하면 실시간으로 캐릭터가 즉시 교체됩니다!
      </div>
    </div>

    <!-- 1-2. VRMA Motion Switcher -->
    <div class="section">
      <div class="sec-title">
        <span>💃 3D 모션 (VRMA) 변경</span>
        <button id="btn-browse-vrma" class="btn-file" type="button">📂 내 PC에서 VRMA 파일 불러오기</button>
      </div>
      <label>기본 모션 (대기/포즈) 선택
        <select id="vrmaMotionSelect"></select>
      </label>
      <div style="display:flex; gap:6px; align-items:center; margin-top:2px;">
        <button id="btn-preview-vrma" type="button" style="flex:1;">▶ 모션 즉시 재생 / 미리보기</button>
        <button id="btn-apply-idle-vrma" class="btn-primary" type="button" style="flex:1;">🔄 기본 대기 모션으로 적용</button>
      </div>
      <div style="font-size:10px; color:#8aa8b0; line-height:1.4;">
        * BOOTH 또는 VRoid에서 다운로드한 <b>.vrma</b> 파일을 불러오면 캐릭터의 기본 자세나 동작을 원하는 모션으로 자유롭게 변경할 수 있습니다!
      </div>
    </div>

    
    <!-- Mode Selection -->
    <div class="section">
      <div class="sec-title"><span>🎓 대화 모드 선택</span></div>
      <label>기본 모드
        <select id="chatModeSelect">
          <option value="free">🗣️ 일상 대화 모드 (버추얼 싱어 미쿠)</option>
          <option value="rp">🎭 롤플레잉 / RP 모드 (행동 서술 *...* 및 3D 제스처 연동)</option>
          <option value="tutor">📚 일본어/외국어 튜터 모드 (실시간 문법 교정 & 단어 수집)</option>
        </select>
      </label>
    </div>

    <!-- User Persona & Relationship Settings -->
    <div class="section">
      <div class="sec-title"><span>👤 사용자 페르소나 & 호칭 설정</span></div>
      <label>사용자 이름 / 닉네임
        <input id="userNameInput" placeholder="마스터" />
      </label>
      <label>미쿠가 나를 부르는 호칭
        <input id="callNameInput" placeholder="마스터 (예: 선배, 오빠, 마스터)" />
      </label>
      <label>캐릭터와의 관계 설정
        <input id="relationshipInput" placeholder="서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너" />
      </label>
      <div style="font-size:10px; color:#8aa8b0; line-height:1.4;">
        * 페르소나를 변경하면 미쿠가 호칭과 관계를 기억하여 그에 맞게 말투와 행동을 맞춰줍니다!
      </div>
    </div>

    <!-- 2. AI LLM Provider -->
    <div class="section">
      <div class="sec-title"><span>🤖 AI 대화 엔진 (LLM)</span></div>
      <label>엔진 선택
        <select id="provider">
          <option value="ollama">Ollama (로컬 GPU 가속 Gemma4)</option>
          <option value="gemini">Google Gemini Flash (0.2초 초고속)</option>
          <option value="easyproxy">EasyProxy :8317</option>
        </select>
      </label>
      <div id="gemini-fields" style="display:none; flex-direction:column; gap:6px;">
        <label>Gemini API Key (Google AI Studio)
          <input id="geminiApiKey" type="password" placeholder="AIzaSy..." />
        </label>
        <label>Gemini 모델 선택
          <select id="geminiModel">
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (초고속 추천)</option>
            <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
          </select>
        </label>
      </div>
      <div id="ollama-row" style="display:flex; flex-direction:column; gap:6px;">
        <label>설치된 Ollama 모델 선택
          <select id="ollamaModelSelect"></select>
        </label>
        <label>직접 모델명 입력
          <input id="model" placeholder="gemma4:12b" />
        </label>
      </div>
    </div>

    <!-- 3. TTS Voice -->
    <div class="section">
      <div class="sec-title"><span>🎙️ 음성 합성 (TTS & 보이스)</span></div>
      <label>음성 출력 사용
        <select id="tts"><option value="on">켜기</option><option value="off">끄기</option></select>
      </label>
      <label>TTS 제공자
        <select id="ttsProvider">
          <option value="fish">🐟 Fish Audio S2.1-Pro Free (100% 무료 클라우드 / 리얼 감정·웃음)</option>
          <option value="voxcpm">VoxCPM2 (RTX 5090 애니메이션 클론 보이스)</option>
          <option value="irodori">Irodori-TTS (일본어 원어민 억양 LoRA)</option>
          <option value="web">Web Speech (시스템 기본 음성)</option>
        </select>
      </label>
      <!-- Fish Audio Cloud Settings Card -->
      <div id="fish-audio-card" style="margin-top:8px; padding:12px; background:rgba(0,210,255,0.08); border:1px solid rgba(0,210,255,0.4); border-radius:10px;">
        <div style="font-size:12.5px; font-weight:800; color:#00d2ff; margin-bottom:4px; display:flex; align-items:center; justify-content:space-between;">
          <span>🐟 Fish Audio S2.1-Pro Free 클라우드 설정</span>
          <span style="font-size:9.5px; background:rgba(100,255,150,0.2); color:#64ff96; padding:2px 8px; border-radius:99px; border:1px solid rgba(100,255,150,0.4); font-weight:700;">100% 무료 티어</span>
        </div>
        <div style="font-size:10.5px; color:#8aa8b0; line-height:1.4; margin-bottom:8px;">
          * fish.audio 에서 무료 가입 후 발급받은 API 키를 넣으면 최신 플래그십 엔진을 <b>로컬 VRAM 0% 사용</b>으로 완전 무료로 즐길 수 있습니다.
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:11px;">Fish Audio API Key (필수)
            <div style="display:flex; gap:6px; margin-top:2px;">
              <input id="fishApiKey" type="password" placeholder="fish.audio의 API Keys에서 복사한 키 붙여넣기" style="flex:1;" />
              <button id="btn-open-fish-site" type="button" class="btn-file" style="background:#00d2ff; color:#06141d; font-weight:800; padding:6px 12px; border-radius:6px; font-size:11px; border:none; cursor:pointer; white-space:nowrap;">키 발급 ↗</button>
            </div>
            <div id="fish-key-hint" style="font-size:10px; color:#ffb432; margin-top:3px; line-height:1.3;">
              ⚠️ API 키가 비어있습니다! 오른쪽 [키 발급 ↗] 버튼에서 무료 키를 복사해 붙여넣어주세요 (비어있으면 기본 기계음으로 대체됨).
            </div>
          </label>
          <label style="font-size:11px;">캐릭터 보이스 모델 ID (Reference ID)
            <div style="display:flex; gap:6px; margin-top:2px;">
              <input id="fishVoiceId" placeholder="acc8237220d8470985ec9be6c4c480a9" style="flex:1;" />
              <button id="btn-add-current-fav" type="button" style="background:rgba(255,215,0,0.15); border:1px solid rgba(255,215,0,0.4); color:#ffd700; font-size:10.5px; font-weight:700; border-radius:6px; padding:0 10px; cursor:pointer; white-space:nowrap;" title="현재 입력된 Voice ID를 즐겨찾기에 등록">⭐ 즐겨찾기 추가</button>
            </div>
            <!-- 🎧 현재 선택된 보이스 이름 실시간 표시 배지 -->
            <div id="fish-voice-info-bar" style="margin-top:5px; padding:5px 9px; background:rgba(0,0,0,0.35); border:1px solid rgba(0,210,255,0.3); border-radius:6px; display:flex; align-items:center; justify-content:space-between; gap:8px;">
              <div style="display:flex; align-items:center; gap:6px; overflow:hidden;">
                <span style="font-size:10px; color:#8aa8b0; white-space:nowrap;">선택된 음성:</span>
                <span id="fish-voice-name-text" style="font-size:11.5px; font-weight:700; color:#00d2ff; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">확인 중…</span>
              </div>
              <span id="fish-voice-type-badge" style="font-size:9.5px; padding:1px 6px; border-radius:4px; font-weight:600; white-space:nowrap; background:rgba(255,215,0,0.18); color:#ffd700; border:1px solid rgba(255,215,0,0.35);">⭐ 내 즐겨찾기</span>
            </div>
          </label>

          <!-- ⭐ 내 즐겨찾기 보이스 -->
          <div style="margin-top:6px; padding:6px 8px; border-radius:6px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,215,0,0.3);">
            <div style="font-size:10.5px; font-weight:700; color:#ffd700; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
              <span>⭐ 내 즐겨찾기 보이스</span>
              <span id="fish-fav-count" style="color:#8aa8b0; font-size:9.5px;">(0개 등록됨)</span>
            </div>
            <div id="fish-favorites-list" style="display:flex; gap:4px; flex-wrap:wrap; min-height:22px; align-items:center;">
              <span style="font-size:9.5px; color:#607d8b; font-style:italic;">등록된 즐겨찾기가 없습니다. 아래 랭킹/검색에서 [⭐ 즐겨찾기]를 눌러 등록해보세요.</span>
            </div>
          </div>

          <div style="font-size:10px; color:#8aa8b0; display:flex; align-items:center; gap:4px; margin-top:4px;">
            <span style="color:#39c5bb; font-weight:700;">🎵 기본 보컬로이드:</span>
            <button type="button" class="btn-fish-preset" data-id="acc8237220d8470985ec9be6c4c480a9" style="background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">미쿠 (글로벌)</button>
            <button type="button" class="btn-fish-preset" data-id="6717a74323274cb296ea9a0da654c977" style="background:rgba(57,197,187,0.15); border:1px solid rgba(57,197,187,0.3); border-radius:4px; color:#e8fbff; font-size:10px; padding:2px 6px; cursor:pointer;">미쿠 (일본어)</button>
          </div>

          <!-- 🔥 전 세계 인기 보이스 랭킹 (장르별 & 국적별 좋아요/다운로드 순) & 실시간 검색 -->
          <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(0,210,255,0.2);">
            <div style="font-size:10.5px; font-weight:700; color:#00d2ff; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
              <span>🔥 인기 보이스 랭킹 & 캐릭터 탐색</span>
              <div style="display:flex; gap:6px; align-items:center;">
                <button id="btn-open-downloads-folder" type="button" style="background:transparent; border:none; color:#ffd700; font-size:9.5px; cursor:pointer; text-decoration:underline;" title="내 PC 다운로드 폴더 열기">📂 다운로드 보관함 ↗</button>
                <button id="btn-open-fish-models" type="button" style="background:transparent; border:none; color:#8aa8b0; font-size:9.5px; cursor:pointer; text-decoration:underline;">웹 라이브러리 ↗</button>
              </div>
            </div>

            <!-- 장르/카테고리 탭 버튼 바 (게임 / 애니 / 성우 / 캐릭터 / 전체) -->
            <div id="fish-genre-tabs" style="display:flex; gap:4px; margin-bottom:7px; overflow-x:auto; padding-bottom:2px;">
              <button type="button" class="fish-tab-btn active" data-genre="gaming" style="padding:4px 9px; font-size:10.5px; font-weight:700; border-radius:6px; cursor:pointer; border:1px solid #00d2ff; background:#00d2ff; color:#06141d; white-space:nowrap; transition:all 0.15s;">🎮 게임</button>
              <button type="button" class="fish-tab-btn" data-genre="anime" style="padding:4px 9px; font-size:10.5px; font-weight:700; border-radius:6px; cursor:pointer; border:1px solid rgba(0,210,255,0.3); background:rgba(0,210,255,0.1); color:#e8fbff; white-space:nowrap; transition:all 0.15s;">📺 애니</button>
              <button type="button" class="fish-tab-btn" data-genre="voice-actor" style="padding:4px 9px; font-size:10.5px; font-weight:700; border-radius:6px; cursor:pointer; border:1px solid rgba(255,107,139,0.4); background:rgba(255,107,139,0.12); color:#ff9ab0; white-space:nowrap; transition:all 0.15s;">🎙️ 성우 (VA)</button>
              <button type="button" class="fish-tab-btn" data-genre="character-voice" style="padding:4px 9px; font-size:10.5px; font-weight:700; border-radius:6px; cursor:pointer; border:1px solid rgba(0,210,255,0.3); background:rgba(0,210,255,0.1); color:#e8fbff; white-space:nowrap; transition:all 0.15s;">🎭 캐릭터</button>
              <button type="button" class="fish-tab-btn" data-genre="all" style="padding:4px 9px; font-size:10.5px; font-weight:700; border-radius:6px; cursor:pointer; border:1px solid rgba(0,210,255,0.3); background:rgba(0,210,255,0.1); color:#e8fbff; white-space:nowrap; transition:all 0.15s;">🌐 전체</button>
            </div>

            <!-- 장르 & 국적 & 정렬 필터 바 -->
            <div style="display:flex; gap:4px; align-items:center; margin-bottom:5px; flex-wrap:wrap;">
              <div style="flex:1; min-width:85px; display:flex; flex-direction:column; gap:2px;">
                <span style="font-size:9px; color:#8aa8b0;">장르 (Genre)</span>
                <select id="fish-filter-genre" style="width:100%; font-size:10px; padding:2px 4px; background:rgba(0,0,0,0.4); color:#e8fbff; border:1px solid rgba(0,210,255,0.3); border-radius:4px;">
                  <option value="gaming">🎮 게임 (Gaming)</option>
                  <option value="anime">📺 애니 (Anime)</option>
                  <option value="voice-actor">🎙️ 성우 (Voice Actor / CV)</option>
                  <option value="character-voice">🎭 캐릭터/버튜버</option>
                  <option value="all">🌐 전체 장르 (All)</option>
                </select>
              </div>
              <div style="flex:1; min-width:85px; display:flex; flex-direction:column; gap:2px;">
                <span style="font-size:9px; color:#8aa8b0;">국적/언어 (Language)</span>
                <select id="fish-filter-lang" style="width:100%; font-size:10px; padding:2px 4px; background:rgba(0,0,0,0.4); color:#e8fbff; border:1px solid rgba(0,210,255,0.3); border-radius:4px;">
                  <option value="ko">🇰🇷 한국어 (Korean)</option>
                  <option value="ja">🇯🇵 일본어 (Japanese)</option>
                  <option value="en">🇺🇸 영어 (English)</option>
                  <option value="zh">🇨🇳 중국어 (Chinese)</option>
                  <option value="all">🌐 전 세계 (All)</option>
                </select>
              </div>
              <div style="flex:1; min-width:100px; display:flex; flex-direction:column; gap:2px;">
                <span style="font-size:9px; color:#8aa8b0;">정렬 (Sort by)</span>
                <select id="fish-filter-sort" style="width:100%; font-size:10px; padding:2px 4px; background:rgba(0,0,0,0.4); color:#ffd700; border:1px solid rgba(255,215,0,0.4); border-radius:4px;">
                  <option value="likes">❤️ 좋아요 많은 순</option>
                  <option value="downloads">📥 다운로드/사용 많은 순</option>
                </select>
              </div>
              <div style="display:flex; gap:3px; margin-top:13px;">
                <button id="btn-fetch-ranking" type="button" title="1위부터 처음으로 새로고침" style="background:#00d2ff; color:#06141d; font-weight:800; padding:3px 8px; border-radius:5px; font-size:10.5px; border:none; cursor:pointer; white-space:nowrap;">🔥 1위부터</button>
                <button id="btn-refresh-ranking" type="button" title="다음 50개 더 불러오기 (목록 아래로 스크롤해도 자동 추가)" style="background:rgba(255,255,255,0.12); color:#e8fbff; font-weight:700; padding:3px 8px; border-radius:5px; font-size:10.5px; border:1px solid rgba(255,255,255,0.25); cursor:pointer; white-space:nowrap;">🔄 더보기</button>
              </div>
            </div>

            <!-- 직접 검색 입력창 -->
            <div style="display:flex; gap:4px; margin-bottom:5px;">
              <input id="fish-search-input" placeholder="원하는 캐릭터 영문 직접 검색 (예: Furina, Hayami, Gojo...)" style="flex:1; font-size:10px; padding:3px 8px;" />
              <button id="btn-fish-search" type="button" class="btn-file" style="background:#39c5bb; color:#06141d; font-weight:800; padding:3px 8px; border-radius:5px; font-size:10.5px; border:none; cursor:pointer; white-space:nowrap;">검색</button>
            </div>

            <!-- 결과 카운트 및 정렬 안내 -->
            <div style="display:flex; justify-content:space-between; align-items:center; font-size:9.5px; color:#8aa8b0; margin-bottom:3px; padding:0 2px;">
              <span id="fish-results-count">조회 결과: 0개</span>
              <span id="fish-sort-label" style="color:#00d2ff;">정렬: ❤️ 좋아요 많은 순</span>
            </div>

            <div id="fish-search-results" style="display:flex; max-height:290px; overflow-y:auto; flex-direction:column; gap:4px; padding-right:2px;">
              <span style="color:#8aa8b0; font-size:10px; padding:8px 0; text-align:center;">상단 [🔥 1위부터] 또는 [🔄 더보기]를 누르면 실시간 랭킹 순위가 로드됩니다.</span>
            </div>
          </div>
          <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
            <label style="font-size:11px; flex:1;">지연 시간 모드
              <select id="fishLatency" style="width:100%; margin-top:2px;">
                <option value="low">Low (최저 지연 0.3~0.5초 - 실시간 대화 추천)</option>
                <option value="balanced">Balanced (균형)</option>
                <option value="normal">Normal (최고 음질)</option>
              </select>
            </label>
            <button id="btn-test-fish" type="button" style="height:32px; margin-top:16px; background:#00d2ff; color:#06141d; font-weight:800; border:none; border-radius:6px; padding:0 12px; font-size:11px; cursor:pointer; white-space:nowrap;">
              ▶ 음성 테스트
            </button>
          </div>
        </div>
      </div>

      <label id="voxcpm-voice-row">캐릭터 목소리 선택
        <div style="display:flex; gap:6px; align-items:center; margin-top:4px;">
          <select id="ttsVoiceId" style="flex:1;"></select>
          <button id="btn-preview-voice" type="button" style="background:#39c5bb; color:#071318; font-weight:700; white-space:nowrap; padding:6px 12px; border-radius:8px; border:none; cursor:pointer;" title="선택한 목소리 샘플 즉시 재생">▶ 미리듣기</button>
        </div>
      </label>
      <div id="voice-status-box" style="margin-top:4px; padding:8px 12px; border-radius:8px; background:rgba(0,0,0,0.4); border:1px solid rgba(57,197,187,0.25); display:flex; align-items:center; justify-content:space-between; font-size:11px;">
        <span style="color:#8aa8b0;">보이스 로딩 상태:</span>
        <span id="voice-status-text" style="font-weight:700; color:#39c5bb;">🟢 준비 완료</span>
      </div>

      <!-- Character Voice Profile (Unified Single Voice Mode) -->
      <div id="voice-profile-card" style="margin-top:10px; padding:12px; background:rgba(57,197,187,0.07); border:1px solid rgba(57,197,187,0.35); border-radius:10px;">
        <div style="font-size:12.5px; font-weight:800; color:#39c5bb; margin-bottom:4px; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span>🎭 캐릭터 보이스 프로필</span>
            <span style="font-size:9.5px; background:rgba(100,255,150,0.15); color:#64ff96; border:1px solid rgba(100,255,150,0.35); padding:1px 6px; border-radius:4px; font-weight:700;">단일 음성 일관 모드</span>
          </div>
          <span style="font-size:9.5px; color:#8aa8b0;">⚡ 최저 지연 & 톤 유지</span>
        </div>
        <div style="font-size:10px; color:#8aa8b0; line-height:1.4; margin-bottom:10px;">
          * 언어별 분기로 인한 음색 왜곡 및 딜레이(2~4초)를 해결하기 위해, <b>하나의 통일된 단일 음성</b>으로 한국어/일본어/영어를 일관되게 발화합니다.
        </div>

        <div style="display:flex; gap:6px; align-items:center; margin-bottom:10px;">
          <label style="font-size:11px; flex:1;">활성 보이스 프로필
            <select id="activeVoiceProfileSelect" style="width:100%; margin-top:2px;"></select>
          </label>
          <button id="btn-add-profile" type="button" style="height:32px; margin-top:16px; background:rgba(57,197,187,0.2); color:#39c5bb; border:1px solid rgba(57,197,187,0.4); border-radius:6px; padding:0 10px; font-size:10.5px; font-weight:700; cursor:pointer; white-space:nowrap;">+ 새 프로필</button>
          <button id="btn-del-profile" type="button" style="height:32px; margin-top:16px; background:rgba(255,107,139,0.15); color:#ff6b8b; border:1px solid rgba(255,107,139,0.35); border-radius:6px; padding:0 8px; font-size:10.5px; font-weight:700; cursor:pointer; white-space:nowrap;" title="현재 프로필 삭제">🗑️ 삭제</button>
        </div>

        <!-- Single Unified Profile Config Panel -->
        <div style="padding:10px; border-radius:8px; background:rgba(0,0,0,0.35); border:1px solid rgba(57,197,187,0.25); display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; gap:8px;">
            <label style="font-size:10.5px; flex:1;">통합 선호 음성 엔진
              <select id="profileUnifiedEngine" style="width:100%; font-size:11px; padding:4px 6px; margin-top:2px;">
                <option value="fish">🐟 Fish Audio S2.1 Pro (100% 무료 클라우드 / 리얼 감정·웃음)</option>
                <option value="voxcpm">🎙️ VoxCPM2 (RTX 5090 로컬 애니메이션 제로샷 클론)</option>
                <option value="irodori">🌸 Irodori-TTS (원어민 억양 LoRA)</option>
                <option value="web">🌐 Web Speech (기본 시스템 음성)</option>
              </select>
            </label>
          </div>

          <label style="font-size:10.5px;">통합 참조 보이스 / Reference ID
            <div style="display:flex; gap:6px; margin-top:2px;">
              <input id="profileUnifiedRef" placeholder="Fish Voice ID 또는 VoxCPM WAV 음성 ID" style="flex:1; font-size:11px; padding:4px 8px;" />
            </div>
            <!-- Unified Voice Title Badge -->
            <div id="profile-voice-name-badge" style="margin-top:4px; font-size:10.5px; display:flex; align-items:center; gap:6px; background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:5px; border:1px solid rgba(57,197,187,0.2);">
              <span style="color:#8aa8b0; font-size:9.5px;">현재 음성:</span>
              <span id="profile-voice-title-display" style="font-weight:700; color:#39c5bb; font-size:11px;">-</span>
            </div>
          </label>
        </div>

        <div style="font-size:9.5px; color:#8aa8b0; line-height:1.4; margin-top:6px;">
          * 프로필을 전환하면 상단 TTS 제공자 및 캐릭터 목소리가 유기적으로 즉시 연동됩니다.
        </div>
      </div>

      <!-- VoxCPM Reference WAV & Clone Studio -->
      <div id="voxcpm-studio-card" style="margin-top:10px; padding:12px; background:rgba(255,107,139,0.06); border:1px solid rgba(255,107,139,0.3); border-radius:10px;">
        <div style="font-size:12.5px; font-weight:800; color:#ff8ba7; margin-bottom:4px; display:flex; align-items:center; justify-content:space-between;">
          <span>🎙️ VoxCPM2 Reference Voice Studio (클론 제작)</span>
          <span style="font-size:9.5px; background:rgba(255,107,139,0.2); color:#ff8ba7; padding:2px 8px; border-radius:99px; font-weight:700;">Zero-Shot</span>
        </div>
        <div style="font-size:10px; color:#8aa8b0; line-height:1.4; margin-bottom:8px;">
          * 3~10초 길이의 깨끗한 단일 화자 오디오(WAV/MP3)와 대사(Transcript)를 등록하면 RTX 5090에서 지연 없이 즉시 음색을 복제합니다.
        </div>

        <div style="display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; gap:6px; align-items:center;">
            <button id="btn-choose-audio" type="button" class="btn-file" style="background:rgba(255,107,139,0.2); color:#ff9ab0; border-color:rgba(255,107,139,0.4); font-size:11px; padding:5px 10px; cursor:pointer; white-space:nowrap;">📂 WAV 파일 선택</button>
            <span id="selected-audio-name" style="font-size:10px; color:#8aa8b0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">선택된 파일 없음</span>
          </div>

          <label style="font-size:10.5px;">보이스 식별 이름
            <input id="studio-voice-name" placeholder="예: my_custom_miku" style="font-size:10.5px; padding:4px 8px;" />
          </label>

          <label style="font-size:10.5px;">클론 모드
            <select id="profileCloneMode" style="width:100%; font-size:10.5px; padding:4px 8px;">
              <option value="reference">Standard Clone (Reference WAV만 사용)</option>
              <option value="ultimate">Ultimate Clone (Reference WAV + 대사 Transcript 정밀 매칭)</option>
            </select>
          </label>

          <label style="font-size:10.5px;">오디오 대사 (Transcript - Ultimate Clone 시 필수)
            <input id="studio-prompt-text" placeholder="오디오에서 말하는 정확한 대사를 입력하세요 (예: 안녕하세요! 만나서 반가워요.)" style="font-size:10.5px; padding:4px 8px;" />
          </label>

          <!-- 저작권/권한 확인 체크박스 (지침 16 & 18 준수) -->
          <div style="display:flex; align-items:flex-start; gap:6px; margin-top:3px; padding:6px; background:rgba(0,0,0,0.3); border-radius:6px; border:1px solid rgba(255,215,0,0.25);">
            <input id="chk-voice-auth" type="checkbox" style="margin-top:2px; cursor:pointer;" />
            <label for="chk-voice-auth" style="font-size:9.5px; color:#ffd700; line-height:1.35; cursor:pointer;">
              본인은 이 Reference Audio를 AI 음성 합성 및 보이스 복제에 사용할 정당한 권한이 있음을 확인합니다. (타인의 무단 음성 복제 금지)
            </label>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
            <button id="btn-create-voice" type="button" class="btn-primary" style="background:#ff6b8a; border-color:#ff6b8a; font-size:11px; padding:5px 14px; cursor:pointer;">✨ 보이스 등록 및 활성화</button>
          </div>

          <div id="studio-status" style="display:none; padding:6px 10px; border-radius:6px; font-size:10.5px; text-align:center;"></div>
        </div>
      </div>
    </div>

    <!-- 4. Character Scale & Controls -->
    <div class="section">
      <div class="sec-title"><span>📐 캐릭터 크기 및 단축키</span></div>
      <label>캐릭터 크기 (휠 스크롤로도 조절 가능)
        <div style="display:flex; align-items:center; gap:8px;">
          <input id="characterScale" type="range" min="0.5" max="2.0" step="0.05" value="1.0" style="flex:1;" />
          <span id="scaleVal" style="font-weight:700; color:#39c5bb; width:35px;">1.0x</span>
        </div>
      </label>
      <label>PTT 음성인식 단축키
        <input id="pttKey" placeholder="Space 또는 F8" />
      </label>
    </div>
  </div>

  <div class="footer no-drag">
    <button id="clear-hist" type="button" style="color:#ff6b8a; border-color:rgba(255,107,138,0.3);">대화 기록 초기화</button>
    <button id="btn-save" class="btn-primary" type="button">설정 저장 및 적용</button>
  </div>
</div>
`;

const closeBtn = document.getElementById("btn-close")!;
const browseVrmBtn = document.getElementById("btn-browse-vrm")!;
const vrmSelect = document.getElementById("vrmModelSelect") as HTMLSelectElement;
const browseVrmaBtn = document.getElementById("btn-browse-vrma")!;
const vrmaSelect = document.getElementById("vrmaMotionSelect") as HTMLSelectElement;
const btnPreviewVrma = document.getElementById("btn-preview-vrma") as HTMLButtonElement;
const btnApplyIdleVrma = document.getElementById("btn-apply-idle-vrma") as HTMLButtonElement;
const providerSel = document.getElementById("provider") as HTMLSelectElement;
const geminiFields = document.getElementById("gemini-fields")!;
const geminiApiKeyInput = document.getElementById("geminiApiKey") as HTMLInputElement;
const geminiModelSel = document.getElementById("geminiModel") as HTMLSelectElement;
const modelInput = document.getElementById("model") as HTMLInputElement;
const ollamaModelSelect = document.getElementById("ollamaModelSelect") as HTMLSelectElement;
const ttsSel = document.getElementById("tts") as HTMLSelectElement;
const ttsProvSel = document.getElementById("ttsProvider") as HTMLSelectElement;
const chatModeSelect = document.getElementById("chatModeSelect") as HTMLSelectElement;
const userNameInput = document.getElementById("userNameInput") as HTMLInputElement;
const callNameInput = document.getElementById("callNameInput") as HTMLInputElement;
const relationshipInput = document.getElementById("relationshipInput") as HTMLInputElement;
const voiceSel = document.getElementById("ttsVoiceId") as HTMLSelectElement;
const scaleInput = document.getElementById("characterScale") as HTMLInputElement;
const scaleVal = document.getElementById("scaleVal")!;
const pttKeyInput = document.getElementById("pttKey") as HTMLInputElement;
const clearHistBtn = document.getElementById("clear-hist")!;
const saveBtn = document.getElementById("btn-save")!;

let localSettings: AppSettings | null = null;
let installedVrmList: string[] = [];
let installedVrmaList: string[] = [];

closeBtn.addEventListener("click", () => {
  const k = fishApiKeyInput?.value.trim();
  const v = fishVoiceIdInput?.value.trim();
  if (k) {
    localStorage.setItem("fishApiKey", k);
    window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: k, fishVoiceId: v || undefined });
  }
  window.miku.send(Ipc.CLOSE_SETTINGS);
});

browseVrmBtn.addEventListener("click", () => {
  window.miku.send(Ipc.SELECT_VRM_FILE);
});

vrmSelect.addEventListener("change", () => {
  const chosen = vrmSelect.value;
  if (chosen) {
    window.miku.send(Ipc.LOAD_VRM_MODEL, chosen);
  }
});

browseVrmaBtn.addEventListener("click", () => {
  window.miku.send(Ipc.SELECT_VRMA_FILE);
});

btnPreviewVrma.addEventListener("click", () => {
  const chosen = vrmaSelect.value;
  if (chosen) {
    window.miku.send(Ipc.PREVIEW_VRMA_MOTION, chosen);
  }
});

btnApplyIdleVrma.addEventListener("click", () => {
  const chosen = vrmaSelect.value;
  if (chosen) {
    window.miku.send(Ipc.LOAD_VRMA_MOTION, chosen);
  }
});

vrmaSelect.addEventListener("change", () => {
  const chosen = vrmaSelect.value;
  if (chosen) {
    window.miku.send(Ipc.LOAD_VRMA_MOTION, chosen);
  }
});

providerSel.addEventListener("change", () => {
  geminiFields.style.display = providerSel.value === "gemini" ? "flex" : "none";
});

scaleInput.addEventListener("input", () => {
  const val = parseFloat(scaleInput.value);
  scaleVal.textContent = val.toFixed(2) + "x";
  window.miku.send(Ipc.SET_SCALE, val);
});

clearHistBtn.addEventListener("click", () => {
  if (confirm("대화 기억을 초기화하시겠습니까?")) {
    window.miku.send(Ipc.CLEAR_HISTORY);
  }
});


const fishCard = document.getElementById("fish-audio-card") as HTMLDivElement;
const fishApiKeyInput = document.getElementById("fishApiKey") as HTMLInputElement;
const fishVoiceIdInput = document.getElementById("fishVoiceId") as HTMLInputElement;
const fishLatencySelect = document.getElementById("fishLatency") as HTMLSelectElement;
const btnTestFish = document.getElementById("btn-test-fish") as HTMLButtonElement;
const btnOpenFishSite = document.getElementById("btn-open-fish-site") as HTMLButtonElement;


function updateKeyHint(): void {
  const k = fishApiKeyInput?.value.trim();
  const hint = document.getElementById("fish-key-hint");
  if (hint) {
    if (k) {
      hint.style.color = "#64ff96";
      hint.innerHTML = "✅ API 키가 등록되었습니다! 이제 S2.1-Pro 리얼 보이스가 출력됩니다.";
    } else {
      hint.style.color = "#ffb432";
      hint.innerHTML = "⚠️ API 키가 비어있습니다! 오른쪽 <b>[키 발급 ↗]</b>에서 무료 키를 복사해 붙여넣어주세요 (비어있으면 기본 기계음으로 대체됨).";
    }
  }
}

function updateTtsProviderUi(prov: string): void {
  if (fishCard) fishCard.style.display = prov === "fish" ? "block" : "none";
  const voxRow = document.getElementById("voxcpm-voice-row");
  if (voxRow) voxRow.style.display = prov === "fish" ? "none" : "block";
}

ttsProvSel.addEventListener("change", () => {
  const prov = ttsProvSel.value;
  updateTtsProviderUi(prov);
  window.miku.send(Ipc.SETTINGS_UPDATE, { ttsProvider: prov });
  const ref = prov === "fish"
    ? (fishVoiceIdInput?.value.trim() || "")
    : (voiceSel?.value || "");
  syncCurrentProfileVoiceFromExternal(prov as any, ref);
});

btnOpenFishSite?.addEventListener("click", () => {
    window.miku.send(Ipc.OPEN_EXTERNAL_URL, "https://fish.audio/app/api-keys/");
  });

  // Instant auto-save as user types or pastes key
  fishApiKeyInput?.addEventListener("input", () => {
    const k = fishApiKeyInput.value.trim();
    if (k) {
      localStorage.setItem("fishApiKey", k);
      window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: k, ttsProvider: "fish" });
      updateKeyHint();
    } else { updateKeyHint(); }
  });
  fishApiKeyInput?.addEventListener("change", () => {
    const k = fishApiKeyInput.value.trim();
    if (k) {
      localStorage.setItem("fishApiKey", k);
      window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: k, ttsProvider: "fish" });
    }
  });

  // --- Presets, Title Resolution, and Voice Interlock ---
  const FISH_VOICE_PRESETS = [
    { id: "acc8237220d8470985ec9be6c4c480a9", name: "🎵 미쿠 (글로벌)" },
    { id: "6717a74323274cb296ea9a0da654c977", name: "🇯🇵 미쿠 (일본어)" },
    { id: "5ac6fb7171ba419190700620738209d8", name: "⚡ 라이덴 쇼군" },
    { id: "bd08be872bc440918674af072944ba12", name: "💧 후리나" },
    { id: "4858e0be678c4449bf3a7646186edd42", name: "🌱 나히다" },
    { id: "2879aac2931e450f8159d2f65cd918f4", name: "🔥 호두" },
    { id: "7c0ab8e2b1714ce3a80f2622a5cc459c", name: "🌸 반디 (Firefly)" },
    { id: "4c0be7e14fa24928b4f2541ca49b57d0", name: "🕷️ 카프카" },
    { id: "ce8248e10ec54d509f75945ad58ccfb6", name: "⚔️ 프리렌" },
    { id: "6eef1184091d4e96aceb90b4681a5400", name: "🎸 봇치" },
    { id: "ffe41701970d4b339ef7906300716f99", name: "🥜 아냐" },
    { id: "088d160c978f4e8ba98701af1f58f842", name: "🌸 아로나" },
  ];

  const fishVoiceTitleCache = new Map<string, string>();
  let currentFavorites: FishVoiceFavorite[] = [];

  const profileUnifiedEngine = document.getElementById("profileUnifiedEngine") as HTMLSelectElement | null;
  const profileUnifiedRef = document.getElementById("profileUnifiedRef") as HTMLInputElement | null;
  const profileVoiceTitleDisplay = document.getElementById("profile-voice-title-display") as HTMLElement | null;
  const btnDelProfile = document.getElementById("btn-del-profile") as HTMLButtonElement | null;

  function getFishVoiceTitleInfo(id?: string): { title: string; source: "fav" | "preset" | "cache" | "custom" | "empty" } {
    const trimmed = (id || "").trim();
    if (!trimmed) {
      return { title: "선택된 음성 없음 (기본값 사용)", source: "empty" };
    }
    // 1. Check favorites
    const fav = (currentFavorites || []).find((f) => f.id === trimmed)
      || (localSettings?.fishFavorites || []).find((f) => f.id === trimmed);
    if (fav) {
      return { title: fav.title, source: "fav" };
    }
    // 2. Check presets
    const preset = FISH_VOICE_PRESETS.find((p) => p.id === trimmed);
    if (preset) {
      return { title: preset.name, source: "preset" };
    }
    // 3. Check memory cache (from search/downloads/lookups)
    if (fishVoiceTitleCache.has(trimmed)) {
      return { title: fishVoiceTitleCache.get(trimmed)!, source: "cache" };
    }
    // 4. Custom ID fallback
    const short = trimmed.length > 16 ? `${trimmed.substring(0, 8)}…${trimmed.substring(trimmed.length - 4)}` : trimmed;
    return { title: `커스텀 ID (${short})`, source: "custom" };
  }

  function updateFishVoiceTitleBadge(): void {
    const curId = fishVoiceIdInput?.value.trim();
    const nameText = document.getElementById("fish-voice-name-text");
    const typeBadge = document.getElementById("fish-voice-type-badge");
    if (!nameText || !typeBadge) return;

    const info = getFishVoiceTitleInfo(curId);
    nameText.textContent = info.title;

    if (info.source === "fav") {
      typeBadge.style.display = "inline-block";
      typeBadge.textContent = "⭐ 내 즐겨찾기";
      typeBadge.style.background = "rgba(255,215,0,0.18)";
      typeBadge.style.color = "#ffd700";
      typeBadge.style.border = "1px solid rgba(255,215,0,0.35)";
    } else if (info.source === "preset") {
      typeBadge.style.display = "inline-block";
      typeBadge.textContent = "🎵 기본 프리셋";
      typeBadge.style.background = "rgba(57,197,187,0.18)";
      typeBadge.style.color = "#39c5bb";
      typeBadge.style.border = "1px solid rgba(57,197,187,0.35)";
    } else if (info.source === "cache") {
      typeBadge.style.display = "inline-block";
      typeBadge.textContent = "🔥 라이브러리";
      typeBadge.style.background = "rgba(0,210,255,0.18)";
      typeBadge.style.color = "#00d2ff";
      typeBadge.style.border = "1px solid rgba(0,210,255,0.35)";
    } else if (info.source === "custom") {
      typeBadge.style.display = "inline-block";
      typeBadge.textContent = "✏️ 직접 입력 ID";
      typeBadge.style.background = "rgba(255,255,255,0.1)";
      typeBadge.style.color = "#a0b0b8";
      typeBadge.style.border = "1px solid rgba(255,255,255,0.2)";
      if (curId && curId.length >= 16) {
        void tryResolveUnknownFishVoiceTitle(curId);
      }
    } else {
      typeBadge.style.display = "none";
    }
  }

  async function tryResolveUnknownFishVoiceTitle(id: string): Promise<void> {
    if (!id || id.length < 16) return;
    if (fishVoiceTitleCache.has(id)) return;
    const k = fishApiKeyInput?.value.trim() || localSettings?.fishApiKey || "";
    try {
      const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0" };
      if (k) headers["Authorization"] = `Bearer ${k}`;
      const resp = await fetch(`https://api.fish.audio/model/${encodeURIComponent(id)}`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.title) {
          fishVoiceTitleCache.set(id, data.title);
          updateFishVoiceTitleBadge();
          updateProfileVoiceBadge();
        }
      }
    } catch {}
  }

  function updateProfileVoiceBadge(): void {
    if (!profileVoiceTitleDisplay || !profileUnifiedEngine) return;
    const eng = profileUnifiedEngine.value;
    const ref = profileUnifiedRef?.value.trim() || "";
    if (!ref) {
      profileVoiceTitleDisplay.textContent = "(기본 음성)";
      profileVoiceTitleDisplay.style.color = "#8aa8b0";
      return;
    }
    if (eng === "fish") {
      const info = getFishVoiceTitleInfo(ref);
      profileVoiceTitleDisplay.textContent = info.title;
      profileVoiceTitleDisplay.style.color = "#00d2ff";
    } else if (eng === "voxcpm") {
      profileVoiceTitleDisplay.textContent = `🎙️ VoxCPM (${ref})`;
      profileVoiceTitleDisplay.style.color = "#ff8ba7";
    } else if (eng === "irodori") {
      profileVoiceTitleDisplay.textContent = `🌸 Irodori (${ref})`;
      profileVoiceTitleDisplay.style.color = "#39c5bb";
    } else {
      profileVoiceTitleDisplay.textContent = "🌐 시스템 기본 음성";
      profileVoiceTitleDisplay.style.color = "#e8fbff";
    }
  }

  function syncCurrentProfileVoiceFromExternal(engine: string, voiceId: string): void {
    if (!localSettings || !activeVoiceProfileSelect) return;
    const activeId = activeVoiceProfileSelect.value;
    const list = localSettings.voiceProfiles || [];
    const p = list.find((x) => x.id === activeId);
    if (!p) return;

    p.preferredEngine = {
      ...p.preferredEngine,
      default: engine as any,
      ko: engine as any,
      ja: engine as any,
      en: engine as any,
    };

    if (engine === "fish") {
      if (!p.fish) p.fish = {};
      p.fish.referenceId = voiceId;
      p.fish.koReferenceId = voiceId;
      p.fish.jaReferenceId = voiceId;
    } else if (engine === "voxcpm") {
      if (!p.voxcpm) p.voxcpm = {};
      p.voxcpm.defaultReferenceWav = voiceId;
      p.voxcpm.koReferenceWav = voiceId;
      p.voxcpm.jaReferenceWav = voiceId;
    }

    if (profileUnifiedEngine) profileUnifiedEngine.value = engine;
    if (profileUnifiedRef) profileUnifiedRef.value = voiceId;
    updateProfileVoiceBadge();

    localSettings.voiceProfiles = list;
    window.miku.send(Ipc.SETTINGS_UPDATE, {
      voiceProfiles: list,
      activeVoiceProfileId: activeId,
    });
  }

  fishVoiceIdInput?.addEventListener("input", () => {
    const vid = fishVoiceIdInput.value.trim();
    updateFishVoiceTitleBadge();
    if (vid) {
      localStorage.setItem("fishVoiceId", vid);
      syncCurrentProfileVoiceFromExternal("fish", vid);
    }
    renderFavorites();
  });

  fishVoiceIdInput?.addEventListener("change", () => {
    const vid = fishVoiceIdInput.value.trim();
    updateFishVoiceTitleBadge();
    if (vid) {
      localStorage.setItem("fishVoiceId", vid);
      window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: vid });
      syncCurrentProfileVoiceFromExternal("fish", vid);
    }
    renderFavorites();
  });

  document.querySelectorAll(".btn-fish-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.id;
      if (id && fishVoiceIdInput) {
        fishVoiceIdInput.value = id;
        localStorage.setItem("fishVoiceId", id);
        window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: id, ttsProvider: "fish" });
        updateFishVoiceTitleBadge();
        syncCurrentProfileVoiceFromExternal("fish", id);
        renderFavorites();
      }
    });
  });
  
  btnTestFish?.addEventListener("click", () => {
    const apiKey = (fishApiKeyInput?.value.trim() || localStorage.getItem("fishApiKey") || "").trim();
    const voiceId = (fishVoiceIdInput?.value.trim() || localStorage.getItem("fishVoiceId") || "acc8237220d8470985ec9be6c4c480a9").trim();
    if (!apiKey) {
      alert("Fish Audio API 키를 입력해주세요! (fish.audio 에서 무료 발급)");
      fishApiKeyInput?.focus();
      return;
    }
    // Immediately persist to disk and storage
    localStorage.setItem("fishApiKey", apiKey);
    localStorage.setItem("fishVoiceId", voiceId);
    window.miku.send(Ipc.SETTINGS_UPDATE, { fishApiKey: apiKey, fishVoiceId: voiceId, ttsProvider: "fish" });

    btnTestFish.disabled = true;
    btnTestFish.textContent = "⏳ 합성 중…";
    window.miku.send(Ipc.TEST_FISH_VOICE, { apiKey, voiceId });
    setTimeout(() => {
      btnTestFish.disabled = false;
      btnTestFish.textContent = "▶ 음성 테스트";
    }, 4000);
  });


const fishSearchInput = document.getElementById("fish-search-input") as HTMLInputElement;
const btnFishSearch = document.getElementById("btn-fish-search") as HTMLButtonElement;
const fishSearchResults = document.getElementById("fish-search-results") as HTMLDivElement;
const btnOpenFishModels = document.getElementById("btn-open-fish-models") as HTMLButtonElement;
const btnOpenDownloadsFolder = document.getElementById("btn-open-downloads-folder") as HTMLButtonElement;
const btnFetchRanking = document.getElementById("btn-fetch-ranking") as HTMLButtonElement;
const btnRefreshRanking = document.getElementById("btn-refresh-ranking") as HTMLButtonElement;
const fishFilterGenre = document.getElementById("fish-filter-genre") as HTMLSelectElement;
const fishFilterLang = document.getElementById("fish-filter-lang") as HTMLSelectElement;
const fishFilterSort = document.getElementById("fish-filter-sort") as HTMLSelectElement;
const btnAddCurrentFav = document.getElementById("btn-add-current-fav") as HTMLButtonElement;
const fishResultsCount = document.getElementById("fish-results-count") as HTMLSpanElement;
const fishSortLabel = document.getElementById("fish-sort-label") as HTMLSpanElement;
let currentRankingPage = 1;
let currentLoadedCount = 0;
let lastQueryType: "ranking" | "search" = "ranking";
let lastSearchText = "";
let isFetchingMore = false;
let hasMoreVoices = true;

function loadFavorites(fromSettings?: FishVoiceFavorite[]) {
  if (fromSettings && Array.isArray(fromSettings)) {
    currentFavorites = [...fromSettings];
  } else {
    try {
      const stored = localStorage.getItem("fishFavorites");
      if (stored) currentFavorites = JSON.parse(stored);
    } catch {}
  }
  renderFavorites();
  updateFishVoiceTitleBadge();
}

function saveFavorites(nextFavs: FishVoiceFavorite[]) {
  currentFavorites = nextFavs;
  try {
    localStorage.setItem("fishFavorites", JSON.stringify(currentFavorites));
  } catch {}
  window.miku.send(Ipc.SETTINGS_UPDATE, { fishFavorites: currentFavorites });
  renderFavorites();
  updateFishVoiceTitleBadge();
  updateCardFavoriteButtons();
}

function renderFavorites() {
  const container = document.getElementById("fish-favorites-list");
  const countSpan = document.getElementById("fish-fav-count");
  if (!container) return;
  if (countSpan) countSpan.textContent = `(${currentFavorites.length}개 등록됨)`;

  if (currentFavorites.length === 0) {
    container.innerHTML = '<span style="font-size:9.5px; color:#607d8b; font-style:italic;">등록된 즐겨찾기가 없습니다. 아래 랭킹/검색에서 [⭐ 즐겨찾기]를 눌러 등록해보세요.</span>';
    return;
  }

  container.innerHTML = "";
  const curVid = fishVoiceIdInput?.value.trim();

  currentFavorites.forEach((fav) => {
    const chip = document.createElement("div");
    const isSelected = curVid === fav.id;
    chip.style.cssText = `display:inline-flex; align-items:center; background:${isSelected ? 'rgba(0,210,255,0.22)' : 'rgba(255,215,0,0.15)'}; border:1px solid ${isSelected ? '#00d2ff' : 'rgba(255,215,0,0.35)'}; border-radius:4px; overflow:hidden; font-size:10px; margin-bottom:2px; box-shadow:${isSelected ? '0 0 8px rgba(0,210,255,0.35)' : 'none'};`;

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.title = `클릭하여 '${fav.title}' 보이스 즉시 적용`;
    selectBtn.style.cssText = "background:transparent; border:none; color:#e8fbff; padding:2px 6px; cursor:pointer; display:flex; align-items:center; gap:3px;";
    const langBadge = (fav.languages || []).length > 0 ? `<span style="color:#8aa8b0; font-size:8.5px;">[${fav.languages!.join(",")}]</span>` : "";
    const activeBadge = isSelected ? `<span style="color:#64ff96; font-size:9px; font-weight:800; margin-left:2px;">[선택됨]</span>` : "";
    selectBtn.innerHTML = `<span style="color:#ffd700;">⭐</span><span style="max-width:110px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:${isSelected ? '700' : '500'};">${fav.title}</span>${langBadge}${activeBadge}`;
    selectBtn.addEventListener("click", () => {
      if (fishVoiceIdInput) {
        fishVoiceIdInput.value = fav.id;
        localStorage.setItem("fishVoiceId", fav.id);
        window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: fav.id, ttsProvider: "fish" });
        updateFishVoiceTitleBadge();
        syncCurrentProfileVoiceFromExternal("fish", fav.id);
        renderFavorites();
      }
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.title = "즐겨찾기 삭제";
    delBtn.style.cssText = "background:transparent; border:none; border-left:1px solid rgba(255,215,0,0.2); color:#ff6b8b; padding:2px 5px; cursor:pointer; font-weight:bold; font-size:9.5px;";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = currentFavorites.filter((f) => f.id !== fav.id);
      saveFavorites(next);
    });

    chip.appendChild(selectBtn);
    chip.appendChild(delBtn);
    container.appendChild(chip);
  });
}

function updateCardFavoriteButtons() {
  const cards = document.querySelectorAll(".fish-card");
  cards.forEach((card) => {
    const id = (card as HTMLElement).dataset.id;
    const favBtn = card.querySelector(".btn-fav-toggle") as HTMLButtonElement;
    if (!id || !favBtn) return;
    const isFav = currentFavorites.some((f) => f.id === id);
    if (isFav) {
      favBtn.textContent = "★ 등록됨";
      favBtn.style.background = "rgba(255,215,0,0.25)";
      favBtn.style.color = "#ffd700";
      favBtn.style.border = "1px solid #ffd700";
    } else {
      favBtn.textContent = "⭐ 즐겨찾기";
      favBtn.style.background = "rgba(255,215,0,0.1)";
      favBtn.style.color = "#ffd700";
      favBtn.style.border = "1px solid rgba(255,215,0,0.3)";
    }
  });
}

function getGenreBadge(tags: string[] = [], title: string = ""): string {
  const t = tags.map((x) => x.toLowerCase());
  const tit = title.toLowerCase();

  if (
    tit.includes("성우") ||
    tit.includes("声優") ||
    tit.includes("配音") ||
    tit.includes("voice actor") ||
    tit.includes("cv") ||
    t.includes("voice-actor") ||
    t.includes("voice actor") ||
    t.includes("seiyuu")
  ) {
    return `<span style="background:rgba(255,107,139,0.22); color:#ff8fa3; border:1px solid rgba(255,107,139,0.45); border-radius:3px; padding:1px 4px; font-size:8.5px; font-weight:700; margin-right:3px;">🎙️ 성우</span>`;
  }
  if (t.includes("gaming") || t.includes("game") || t.includes("games")) {
    return `<span style="background:rgba(0,210,255,0.22); color:#7ae7ff; border:1px solid rgba(0,210,255,0.45); border-radius:3px; padding:1px 4px; font-size:8.5px; font-weight:700; margin-right:3px;">🎮 게임</span>`;
  }
  if (t.includes("anime") || t.includes("animation")) {
    return `<span style="background:rgba(180,100,255,0.22); color:#d4a8ff; border:1px solid rgba(180,100,255,0.45); border-radius:3px; padding:1px 4px; font-size:8.5px; font-weight:700; margin-right:3px;">📺 애니</span>`;
  }
  if (t.includes("vocaloid") || t.includes("hatsune miku")) {
    return `<span style="background:rgba(57,197,187,0.22); color:#39c5bb; border:1px solid rgba(57,197,187,0.45); border-radius:3px; padding:1px 4px; font-size:8.5px; font-weight:700; margin-right:3px;">🎵 보컬</span>`;
  }
  if (t.includes("character-voice") || t.includes("vtuber")) {
    return `<span style="background:rgba(255,215,0,0.18); color:#ffd700; border:1px solid rgba(255,215,0,0.35); border-radius:3px; padding:1px 4px; font-size:8.5px; font-weight:700; margin-right:3px;">🎭 캐릭터</span>`;
  }
  return `<span style="background:rgba(255,255,255,0.08); color:#a0b0b8; border:1px solid rgba(255,255,255,0.15); border-radius:3px; padding:1px 4px; font-size:8.5px; margin-right:3px;">🎙️ 보이스</span>`;
}

btnAddCurrentFav?.addEventListener("click", () => {
  const id = fishVoiceIdInput?.value.trim();
  if (!id) {
    alert("즐겨찾기에 등록할 캐릭터 보이스 모델 ID가 비어있습니다.");
    fishVoiceIdInput?.focus();
    return;
  }
  if (currentFavorites.some((f) => f.id === id)) {
    alert("이미 즐겨찾기에 등록되어 있는 보이스 ID입니다.");
    return;
  }
  const defaultTitle = getFishVoiceTitleInfo(id).title || "내 보이스";
  const cleanDefault = defaultTitle.startsWith("커스텀") ? "내 보이스" : defaultTitle;
  const name = prompt("즐겨찾기에 등록할 보이스 이름을 입력하세요:", cleanDefault);
  if (name && name.trim()) {
    const next = [{ id, title: name.trim() }, ...currentFavorites];
    saveFavorites(next);
    updateFishVoiceTitleBadge();
  }
});

btnOpenFishModels?.addEventListener("click", () => {
  window.miku.send(Ipc.OPEN_EXTERNAL_URL, "https://fish.audio/models/");
});

btnOpenDownloadsFolder?.addEventListener("click", () => {
  window.miku.send(Ipc.OPEN_DOWNLOADS_FOLDER);
});

function updateListFooter(total?: number) {
  if (!fishSearchResults) return;
  let footer = document.getElementById("fish-list-footer") as HTMLDivElement;
  if (!footer) {
    footer = document.createElement("div");
    footer.id = "fish-list-footer";
    footer.style.cssText = "margin-top:6px; margin-bottom:4px; text-align:center; padding:6px 0;";
  }

  if (hasMoreVoices) {
    const totalDisplay = total ? ` / 전체 약 ${total.toLocaleString()}개` : "";
    footer.innerHTML = `
      <button id="btn-footer-load-more" type="button" style="background:rgba(0,210,255,0.15); border:1px solid rgba(0,210,255,0.4); color:#00d2ff; font-size:10.5px; font-weight:700; border-radius:6px; padding:5px 14px; cursor:pointer; width:95%; transition:all 0.2s;">
        ➕ 다음 50개 더 불러오기 (현재 ${currentLoadedCount}개${totalDisplay})
      </button>
      <div style="font-size:9px; color:#8aa8b0; margin-top:3px;">💡 아래로 스크롤하면 자동으로도 추가됩니다</div>
    `;
    footer.querySelector("#btn-footer-load-more")?.addEventListener("click", (e) => {
      e.stopPropagation();
      loadNextPage();
    });
  } else {
    const totalDisplay = total ? ` (총 ${total.toLocaleString()}개)` : "";
    footer.innerHTML = `<span style="color:#8aa8b0; font-size:10px; font-weight:600;">✓ 모든 음성을 불러왔습니다${totalDisplay}</span>`;
  }
  fishSearchResults.appendChild(footer);
}

function updateListFooterLoading(isLoading: boolean) {
  if (!fishSearchResults) return;
  let footer = document.getElementById("fish-list-footer") as HTMLDivElement;
  if (!footer) {
    footer = document.createElement("div");
    footer.id = "fish-list-footer";
    footer.style.cssText = "margin-top:6px; margin-bottom:4px; text-align:center; padding:6px 0;";
    fishSearchResults.appendChild(footer);
  }
  if (isLoading) {
    footer.innerHTML = '<span style="color:#00d2ff; font-size:10.5px; font-weight:600;">⏳ 다음 50개 음성을 실시간으로 불러오는 중…</span>';
  }
}

function triggerRankingQuery(pageNumber = 1, append = false) {
  if (isFetchingMore) return;
  isFetchingMore = true;
  currentRankingPage = pageNumber;
  lastQueryType = "ranking";
  const tag = fishFilterGenre?.value || "gaming";
  const language = fishFilterLang?.value || "ko";
  const sortBy = (fishFilterSort?.value as "likes" | "downloads") || "likes";

  if (!append) {
    currentLoadedCount = 0;
    hasMoreVoices = true;
    if (fishSearchResults) {
      fishSearchResults.innerHTML = '<span style="color:#00d2ff; font-size:10.5px; padding:8px 0; text-align:center;">🔥 순위 데이터를 실시간으로 불러오는 중…</span>';
    }
  } else {
    updateListFooterLoading(true);
  }

  if (fishSortLabel) {
    fishSortLabel.textContent = sortBy === "downloads" ? "정렬: 📥 다운로드/사용 많은 순" : "정렬: ❤️ 좋아요 많은 순";
  }

  window.miku.send(Ipc.SEARCH_FISH_MODELS, { tag, language, sortBy, pageNumber, pageSize: 50, append });
}

function triggerSearchQuery(pageNumber = 1, append = false) {
  const q = fishSearchInput?.value.trim() || lastSearchText;
  if (!q) return;
  if (isFetchingMore) return;
  isFetchingMore = true;
  lastSearchText = q;
  lastQueryType = "search";
  currentRankingPage = pageNumber;
  const sortBy = (fishFilterSort?.value as "likes" | "downloads") || "likes";

  if (!append) {
    currentLoadedCount = 0;
    hasMoreVoices = true;
    if (fishSearchResults) {
      fishSearchResults.innerHTML = '<span style="color:#00d2ff; font-size:10.5px; padding:8px 0; text-align:center;">🔍 검색 결과를 불러오는 중…</span>';
    }
  } else {
    updateListFooterLoading(true);
  }

  window.miku.send(Ipc.SEARCH_FISH_MODELS, { title: q, sortBy, pageNumber, pageSize: 50, append });
}

function loadNextPage() {
  if (isFetchingMore || !hasMoreVoices) return;
  const nextPage = currentRankingPage + 1;
  if (lastQueryType === "search" && lastSearchText) {
    triggerSearchQuery(nextPage, true);
  } else {
    triggerRankingQuery(nextPage, true);
  }
}

btnFetchRanking?.addEventListener("click", () => triggerRankingQuery(1, false));
btnRefreshRanking?.addEventListener("click", () => {
  if (currentLoadedCount > 0 && hasMoreVoices) {
    loadNextPage();
  } else {
    if (lastQueryType === "search" && lastSearchText) {
      triggerSearchQuery(1, false);
    } else {
      triggerRankingQuery(1, false);
    }
  }
});
function setActiveGenreTab(genre: string) {
  document.querySelectorAll(".fish-tab-btn").forEach((b) => {
    const el = b as HTMLButtonElement;
    const isTarget = el.dataset.genre === genre;
    if (isTarget) {
      el.style.background = "#00d2ff";
      el.style.color = "#06141d";
      el.style.borderColor = "#00d2ff";
      el.classList.add("active");
    } else {
      if (el.dataset.genre === "voice-actor") {
        el.style.background = "rgba(255,107,139,0.12)";
        el.style.color = "#ff9ab0";
        el.style.borderColor = "rgba(255,107,139,0.4)";
      } else {
        el.style.background = "rgba(0,210,255,0.1)";
        el.style.color = "#e8fbff";
        el.style.borderColor = "rgba(0,210,255,0.3)";
      }
      el.classList.remove("active");
    }
  });
  if (fishFilterGenre && fishFilterGenre.value !== genre) {
    fishFilterGenre.value = genre;
  }
}

document.querySelectorAll(".fish-tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const genre = (btn as HTMLElement).dataset.genre || "gaming";
    setActiveGenreTab(genre);
    triggerRankingQuery(1, false);
  });
});

fishFilterGenre?.addEventListener("change", () => {
  setActiveGenreTab(fishFilterGenre.value);
  triggerRankingQuery(1, false);
});
fishFilterLang?.addEventListener("change", () => triggerRankingQuery(1, false));
fishFilterSort?.addEventListener("change", () => {
  if (lastQueryType === "search" && lastSearchText) {
    triggerSearchQuery(1, false);
  } else {
    triggerRankingQuery(1, false);
  }
});

fishSearchResults?.addEventListener("scroll", () => {
  if (isFetchingMore || !hasMoreVoices) return;
  const { scrollTop, scrollHeight, clientHeight } = fishSearchResults;
  if (scrollTop + clientHeight >= scrollHeight - 80) {
    loadNextPage();
  }
});

btnFishSearch?.addEventListener("click", () => triggerSearchQuery(1, false));
fishSearchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    triggerSearchQuery(1, false);
  }
});

window.miku.on(Ipc.SEARCH_FISH_MODELS, (res: unknown) => {
  isFetchingMore = false;
  const r = res as {
    ok: boolean;
    items?: any[];
    error?: string;
    total?: number;
    pageNumber?: number;
    pageSize?: number;
    append?: boolean;
    hasMore?: boolean;
    sortBy?: string;
  };
  if (!fishSearchResults) return;

  hasMoreVoices = Boolean(r?.hasMore);
  if (r?.pageNumber) currentRankingPage = r.pageNumber;

  if (!r || !r.ok || !r.items || r.items.length === 0) {
    if (!r?.append) {
      fishSearchResults.innerHTML = '<span style="color:#8aa8b0; font-size:10.5px; padding:8px 0; text-align:center;">검색/랭킹 결과가 없습니다. 다른 조건으로 검색해보세요.</span>';
      if (fishResultsCount) fishResultsCount.textContent = "조회 결과: 0개";
    } else {
      hasMoreVoices = false;
      updateListFooter(r.total);
    }
    return;
  }

  // Remove existing footer before appending new cards
  const existingFooter = document.getElementById("fish-list-footer");
  if (existingFooter) existingFooter.remove();

  if (!r.append) {
    fishSearchResults.innerHTML = "";
    currentLoadedCount = 0;
  }

  const existingIds = new Set(
    Array.from(fishSearchResults.querySelectorAll(".fish-card")).map((el) => (el as HTMLElement).dataset.id)
  );

  let newlyAdded = 0;
  r.items.forEach((item) => {
    if (existingIds.has(item._id)) return;
    existingIds.add(item._id);
    newlyAdded++;

    const card = document.createElement("div");
    card.className = "fish-card";
    card.dataset.id = item._id;
    card.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:5px 8px; background:rgba(0,0,0,0.35); border:1px solid rgba(0,210,255,0.25); border-radius:6px; font-size:10.5px;";

    const info = document.createElement("div");
    info.style.cssText = "overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; margin-right:6px;";
    const likesFormatted = (item.like_count || 0).toLocaleString();
    const tasksFormatted = (item.task_count || 0).toLocaleString();

    info.innerHTML = `
      <div style="display:flex; align-items:center; gap:3px;">
        ${getGenreBadge(item.tags, item.title)}
        <span style="font-weight:700; color:#e8fbff; max-width:125px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title}</span>
        <span style="color:#8aa8b0; font-size:9px;">[${(item.languages || []).join(",")}]</span>
      </div>
      <div style="font-size:9px; color:#8aa8b0; display:flex; gap:6px; margin-top:2px;">
        <span style="color:#ff6b8b; font-weight:700;">❤️ ${likesFormatted}</span>
        <span style="color:#00d2ff; font-weight:600;">📥 ${tasksFormatted}회</span>
      </div>
    `;

    const btnGroup = document.createElement("div");
    btnGroup.style.cssText = "display:flex; gap:4px; align-items:center;";

    const isFav = currentFavorites.some((f) => f.id === item._id);
    const favBtn = document.createElement("button");
    favBtn.type = "button";
    favBtn.className = "btn-fav-toggle";
    favBtn.style.cssText = `font-size:10px; font-weight:700; border-radius:4px; padding:2px 6px; cursor:pointer; white-space:nowrap; ${isFav ? 'background:rgba(255,215,0,0.25); color:#ffd700; border:1px solid #ffd700;' : 'background:rgba(255,215,0,0.1); color:#ffd700; border:1px solid rgba(255,215,0,0.3);'}`;
    favBtn.textContent = isFav ? "★ 등록됨" : "⭐ 즐겨찾기";
    favBtn.addEventListener("click", () => {
      const already = currentFavorites.some((f) => f.id === item._id);
      if (already) {
        saveFavorites(currentFavorites.filter((f) => f.id !== item._id));
      } else {
        saveFavorites([{ id: item._id, title: item.title, languages: item.languages || [] }, ...currentFavorites]);
      }
    });

    const dlBtn = document.createElement("button");
    dlBtn.type = "button";
    dlBtn.className = "btn-download-voice";
    dlBtn.title = `내 PC로 '${item.title}' 음성셋(오디오+대본) 다운로드`;
    dlBtn.style.cssText = "background:rgba(0,210,255,0.12); color:#00d2ff; border:1px solid rgba(0,210,255,0.35); border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer; white-space:nowrap; font-weight:600;";
    dlBtn.textContent = "📥 다운";
    dlBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dlBtn.disabled = true;
      dlBtn.textContent = "⏳ 다운 중…";
      window.miku.send(Ipc.DOWNLOAD_VOICE_SET, { modelId: item._id, title: item.title });
    });

    const selBtn = document.createElement("button");
    selBtn.type = "button";
    selBtn.style.cssText = "background:#00d2ff; color:#06141d; font-weight:800; border:none; border-radius:4px; padding:2px 8px; font-size:10px; cursor:pointer; white-space:nowrap;";
    selBtn.textContent = "선택";
    selBtn.addEventListener("click", () => {
      if (fishVoiceIdInput) {
        fishVoiceIdInput.value = item._id;
        localStorage.setItem("fishVoiceId", item._id);
        window.miku.send(Ipc.SETTINGS_UPDATE, { fishVoiceId: item._id, ttsProvider: "fish" });
        selBtn.textContent = "✓ 적용됨";
        selBtn.style.background = "#64ff96";
        fishVoiceTitleCache.set(item._id, item.title);
        updateFishVoiceTitleBadge();
        syncCurrentProfileVoiceFromExternal("fish", item._id);
        renderFavorites();
        setTimeout(() => { selBtn.textContent = "선택"; selBtn.style.background = "#00d2ff"; }, 1500);
      }
    });

    btnGroup.appendChild(favBtn);
    btnGroup.appendChild(dlBtn);
    btnGroup.appendChild(selBtn);

    card.appendChild(info);
    card.appendChild(btnGroup);
    fishSearchResults.appendChild(card);
  });

  currentLoadedCount += newlyAdded;

  if (fishResultsCount) {
    const totalStr = r.total ? ` (전체 약 ${r.total.toLocaleString()}개)` : "";
    fishResultsCount.textContent = `조회 결과: ${currentLoadedCount}개${totalStr}`;
  }

  updateListFooter(r.total);
});

window.miku.on(Ipc.DOWNLOAD_VOICE_SET, (res: unknown) => {
  const r = res as { ok: boolean; modelId?: string; title?: string; folderPath?: string; error?: string };
  if (!r) return;
  const card = document.querySelector(`.fish-card[data-id="${r.modelId}"]`);
  const dlBtn = card?.querySelector(".btn-download-voice") as HTMLButtonElement;
  if (r.ok) {
    if (dlBtn) {
      dlBtn.textContent = "✓ 완료 📂";
      dlBtn.style.background = "#64ff96";
      dlBtn.style.color = "#071318";
      dlBtn.style.border = "none";
      dlBtn.disabled = false;
      dlBtn.title = "다운로드된 폴더 열기";
      dlBtn.onclick = (e) => {
        e.stopPropagation();
        window.miku.send(Ipc.OPEN_DOWNLOADS_FOLDER, r.folderPath);
      };
    }
    alert(`'${r.title || "음성"}' 음성셋 다운로드가 완료되었습니다!\n\n저장 위치:\n${r.folderPath}`);
  } else {
    if (dlBtn) {
      dlBtn.textContent = "❌ 실패";
      dlBtn.disabled = false;
      setTimeout(() => {
        dlBtn.textContent = "📥 다운";
      }, 3000);
    }
    alert(`음성셋 다운로드 실패: ${r.error}`);
  }
});

saveBtn.addEventListener("click", () => {
  if (!localSettings) return;
  const next: Partial<AppSettings> = {
    provider: providerSel.value as any,
    geminiApiKey: geminiApiKeyInput.value.trim(),
    geminiModel: geminiModelSel.value,
    model: modelInput.value.trim(),
    pttKey: pttKeyInput.value.trim(),
    ttsEnabled: ttsSel.value === "on",
    ttsProvider: ttsProvSel.value as any,
    ttsVoiceId: voiceSel.value,
    characterScale: parseFloat(scaleInput.value),
    vrmModelPath: vrmSelect.value || localSettings.vrmModelPath,
    vrmaMotionPath: vrmaSelect.value || localSettings.vrmaMotionPath,
    chatMode: chatModeSelect.value as any,
    userName: userNameInput ? userNameInput.value.trim() : "마스터",
    callName: callNameInput ? callNameInput.value.trim() : "마스터",
    relationship: relationshipInput ? relationshipInput.value.trim() : "서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너",
    fishApiKey: fishApiKeyInput ? fishApiKeyInput.value.trim() : "",
    fishVoiceId: fishVoiceIdInput ? fishVoiceIdInput.value.trim() : "",
    fishLatency: (fishLatencySelect ? fishLatencySelect.value : "low") as any,
    fishFavorites: currentFavorites,
    voiceProfiles: localSettings.voiceProfiles,
    activeVoiceProfileId: localSettings.activeVoiceProfileId,
  };
  window.miku.send(Ipc.SETTINGS_UPDATE, next);
  window.miku.send(Ipc.CLOSE_SETTINGS);
});

window.miku.on(Ipc.VRM_MODELS_LIST, (models: unknown) => {
  if (Array.isArray(models)) {
    installedVrmList = models as string[];
    populateVrmModels(installedVrmList, localSettings?.vrmModelPath || "");
  }
});

window.miku.on(Ipc.VRMA_MOTIONS_LIST, (motions: unknown) => {
  if (Array.isArray(motions)) {
    installedVrmaList = motions as string[];
    populateVrmaMotions(installedVrmaList, localSettings?.vrmaMotionPath || "/models/idle_loop.vrma");
  }
});

window.miku.on(Ipc.STATE_SYNC, (s: unknown) => {
  const state = s as { settings: AppSettings; ttsStatus: string; isThinking: boolean };
  const vText = document.getElementById("voice-status-text");
  if (vText) {
    if (state.ttsStatus === "loading") {
      vText.innerHTML = '<span style="color:#ffb432;">🔄 보이스 모델 로딩 중… (GPU VRAM 적재)</span>';
    } else if (state.ttsStatus === "synthesizing") {
      vText.innerHTML = '<span style="color:#39c5bb;">🎙️ 음성 합성 중…</span>';
    } else {
      vText.innerHTML = '<span style="color:#64ff96;">✅ 보이스 로드 완료 (대화 가능)</span>';
    }
  }
  localSettings = state.settings;

  providerSel.value = state.settings.provider;
  geminiFields.style.display = state.settings.provider === "gemini" ? "flex" : "none";
  geminiApiKeyInput.value = state.settings.geminiApiKey || "";
  geminiModelSel.value = state.settings.geminiModel || "gemini-2.5-flash";
  modelInput.value = state.settings.model;
  pttKeyInput.value = state.settings.pttKey;
  ttsSel.value = state.settings.ttsEnabled ? "on" : "off";
  if (ttsProvSel.value !== "fish" || state.settings.ttsProvider === "fish") {
    ttsProvSel.value = state.settings.ttsProvider;
    updateTtsProviderUi(state.settings.ttsProvider);
  }
  scaleInput.value = String(state.settings.characterScale || 1.0);
  scaleVal.textContent = (state.settings.characterScale || 1.0).toFixed(2) + "x";
  if (chatModeSelect) chatModeSelect.value = state.settings.chatMode || "free";
  if (userNameInput) userNameInput.value = state.settings.userName || "마스터";
  if (callNameInput) callNameInput.value = state.settings.callName || "마스터";
  if (relationshipInput) relationshipInput.value = state.settings.relationship || "서로 신뢰하고 편안하게 마음을 터놓는 가까운 파트너";
  if (fishApiKeyInput) fishApiKeyInput.value = state.settings.fishApiKey || "";
  if (fishVoiceIdInput) fishVoiceIdInput.value = state.settings.fishVoiceId || "acc8237220d8470985ec9be6c4c480a9";
  if (fishLatencySelect) fishLatencySelect.value = state.settings.fishLatency || "low";
  loadFavorites(state.settings.fishFavorites);
  updateTtsProviderUi(state.settings.ttsProvider);
    updateKeyHint();

  populateVrmModels(installedVrmList, state.settings.vrmModelPath);
  populateVrmaMotions(installedVrmaList, state.settings.vrmaMotionPath || "/models/idle_loop.vrma");
  populateVoiceProfiles(state.settings.voiceProfiles || [], state.settings.activeVoiceProfileId);
});

const btnPreviewVoice = document.getElementById("btn-preview-voice") as HTMLButtonElement;
let previewAudio: HTMLAudioElement | null = null;

btnPreviewVoice.addEventListener("click", () => {
  const chosen = voiceSel.value;
  if (chosen) {
    window.miku.send(Ipc.PREVIEW_VOICE, chosen);
  }
});

voiceSel.addEventListener("change", () => {
  const chosen = voiceSel.value;
  const vText = document.getElementById("voice-status-text");
  if (vText) {
    vText.innerHTML = `<span style="color:#64ff96;">✅ ${chosen} 보이스 0초 즉시 적용됨</span>`;
  }
  if (chosen) {
    if (localSettings) localSettings.ttsVoiceId = chosen;
    window.miku.send(Ipc.SETTINGS_UPDATE, { ttsVoiceId: chosen, ttsProvider: "voxcpm" });
    window.miku.send(Ipc.PREVIEW_VOICE, chosen);
    syncCurrentProfileVoiceFromExternal("voxcpm", chosen);
  }
});

window.miku.on(Ipc.PLAY_PREVIEW_AUDIO, (payload: unknown) => {
  const p = payload as { b64: string; name: string };
  if (!p?.b64) return;
  if (previewAudio) {
    previewAudio.pause();
    previewAudio = null;
  }
  const bin = atob(p.b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  previewAudio = new Audio(url);
  void previewAudio.play().catch(() => {});
  previewAudio.onended = () => {
    URL.revokeObjectURL(url);
    previewAudio = null;
  };
});


window.miku.on(Ipc.VOICES_LIST, (cat: unknown) => {
  const catalog = (cat as VoiceCatalog) ?? { defaultId: "nilou", voices: [] };
  voiceSel.innerHTML = "";
  for (const v of catalog.voices) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `${v.displayName} (${v.id})`;
    if (v.id === localSettings?.ttsVoiceId) opt.selected = true;
    voiceSel.appendChild(opt);
  }
});


ollamaModelSelect.addEventListener("change", () => {
  const chosen = ollamaModelSelect.value;
  if (chosen) {
    modelInput.value = chosen;
    if (localSettings) {
      window.miku.send(Ipc.SETTINGS_UPDATE, { model: chosen });
    }
  }
});

window.miku.on(Ipc.OLLAMA_MODELS_LIST, (models: unknown) => {
  if (Array.isArray(models)) {
    ollamaModelSelect.innerHTML = "";
    for (const m of models as { name: string; size: string; isAbliterated?: boolean }[]) {
      const opt = document.createElement("option");
      opt.value = m.name;
      const tag = m.isAbliterated ? " [🔓 무검열/시각]" : "";
      opt.textContent = `${m.name} (${m.size})${tag}`;
      if (m.name === (localSettings?.model || "gemma4:12b")) {
        opt.selected = true;
      }
      ollamaModelSelect.appendChild(opt);
    }
  }
});

window.miku.send(Ipc.GET_OLLAMA_MODELS);

function populateVrmModels(models: string[], currentPath: string): void {
  vrmSelect.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    const displayName = m.replace(/^.*[\\\/]/, "");
    opt.textContent = displayName;
    if (m === currentPath || displayName === currentPath.replace(/^.*[\\\/]/, "")) {
      opt.selected = true;
    }
    vrmSelect.appendChild(opt);
  }
}

function formatVrmaDisplayName(pathStr: string): string {
  const file = pathStr.replace(/^.*[\\\/]/, "");
  const lower = file.toLowerCase();
  if (lower.includes("idle_loop")) return "🧘 기본 자연스러운 대기 (idle_loop.vrma)";
  if (lower.includes("vrma_01")) return "✨ 공식 VRMA_01 전신 쇼케이스 (Show full body)";
  if (lower.includes("vrma_02")) return "👋 공식 VRMA_02 정중한 인사 (Greeting / Bow)";
  if (lower.includes("vrma_03")) return "✌️ 공식 VRMA_03 브이 사인 (Peace sign)";
  if (lower.includes("vrma_04")) return "👉 공식 VRMA_04 손총 빵야 (Shoot)";
  if (lower.includes("vrma_05")) return "💫 공식 VRMA_05 360도 스핀 회전 (Spin)";
  if (lower.includes("vrma_06")) return "💃 공식 VRMA_06 모델 포즈 (Model pose)";
  if (lower.includes("vrma_07")) return "🧎 공식 VRMA_07 앉기/스쿼트 (Squat)";
  if (lower.includes("wave")) return "👋 손 흔들기 (Wave)";
  if (lower.includes("laugh")) return "😄 웃음/기쁨 (Laugh)";
  if (lower.includes("nod")) return "🙆 고개 끄덕임 (Nod)";
  if (lower.includes("think")) return "🤔 생각하기 (Think)";
  if (lower.includes("explain")) return "📖 설명하기 (Explain)";
  return "🎬 " + file;
}

function populateVrmaMotions(motions: string[], currentPath: string): void {
  if (!vrmaSelect) return;
  vrmaSelect.innerHTML = "";
  for (const m of motions) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = formatVrmaDisplayName(m);
    if (m === currentPath || m.replace(/^.*[\\\/]/, "") === currentPath.replace(/^.*[\\\/]/, "")) {
      opt.selected = true;
    }
    vrmaSelect.appendChild(opt);
  }
}


// --- Voice Studio Logic Inside Settings ---
const studioVoiceName = document.getElementById("studio-voice-name") as HTMLInputElement;
const btnChooseAudio = document.getElementById("btn-choose-audio") as HTMLButtonElement;
const selectedAudioName = document.getElementById("selected-audio-name") as HTMLSpanElement;
const studioPromptText = document.getElementById("studio-prompt-text") as HTMLInputElement;
const profileCloneMode = document.getElementById("profileCloneMode") as HTMLSelectElement | null;
const btnCreateVoice = document.getElementById("btn-create-voice") as HTMLButtonElement;
const studioStatus = document.getElementById("studio-status") as HTMLDivElement;

let chosenVoiceFilePath = "";

btnChooseAudio?.addEventListener("click", () => {
  window.miku.send(Ipc.SELECT_AUDIO_FILE);
});

window.miku.on(Ipc.SELECT_AUDIO_FILE, (data: unknown) => {
  const d = data as { filePath: string; fileName: string };
  if (d && d.filePath) {
    chosenVoiceFilePath = d.filePath;
    if (selectedAudioName) {
      selectedAudioName.textContent = "✅ " + d.fileName;
      selectedAudioName.style.color = "#39c5bb";
    }
    if (studioVoiceName && !studioVoiceName.value.trim()) {
      studioVoiceName.value = d.fileName.replace(/\.[^/.]+$/, "");
    }
  }
});

btnCreateVoice?.addEventListener("click", () => {
  const name = studioVoiceName?.value.trim();
  if (!name) {
    alert("캐릭터 이름을 입력해주세요!");
    studioVoiceName?.focus();
    return;
  }
  if (!chosenVoiceFilePath) {
    alert("음성 파일(.wav, .mp3)을 선택해주세요!");
    return;
  }

  const authChk = document.getElementById("chk-voice-auth") as HTMLInputElement | null;
  if (authChk && !authChk.checked) {
    alert("⚠️ Reference Audio 사용 권한 확인 체크박스에 동의해야 보이스를 등록할 수 있습니다.");
    authChk.focus();
    return;
  }

  if (studioStatus) {
    studioStatus.style.display = "block";
    studioStatus.style.background = "rgba(57,197,187,0.15)";
    studioStatus.style.color = "#39c5bb";
    studioStatus.innerHTML = "<span>⏳ <b>" + name + "</b> 목소리 정규화 및 등록 중…</span>";
  }
  btnCreateVoice.disabled = true;

  window.miku.send(Ipc.CREATE_CUSTOM_VOICE, {
    name,
    filePath: chosenVoiceFilePath,
    promptText: studioPromptText?.value.trim(),
  });
});

window.miku.on(Ipc.CREATE_CUSTOM_VOICE, (res: unknown) => {
  if (btnCreateVoice) btnCreateVoice.disabled = false;
  const r = res as { ok: boolean; voice?: { id: string; displayName?: string; name?: string }; error?: string };
  if (r && r.ok && r.voice) {
    const vName = r.voice.displayName || r.voice.name || r.voice.id;
    if (studioStatus) {
      studioStatus.style.display = "block";
      studioStatus.style.background = "rgba(100,255,150,0.2)";
      studioStatus.style.color = "#64ff96";
      studioStatus.innerHTML = "<span>🎉 <b>" + vName + "</b> 보이스 등록 완료! 즉시 적용되었습니다.</span>";
    }
    if (localSettings) {
      localSettings.ttsVoiceId = r.voice.id;
      // Also update active voice profile if present
      const activeProf = (localSettings.voiceProfiles || []).find((p) => p.id === localSettings?.activeVoiceProfileId);
      if (activeProf) {
        if (!activeProf.voxcpm) activeProf.voxcpm = {};
        activeProf.voxcpm.koReferenceWav = r.voice.id;
        activeProf.voxcpm.jaReferenceWav = r.voice.id;
        if (profileCloneMode?.value === "ultimate") {
          activeProf.voxcpm.cloneMode = "ultimate";
          activeProf.voxcpm.koPromptText = studioPromptText?.value.trim();
        }
      }
    }
    if (voiceSel) {
      voiceSel.value = r.voice.id;
    }
    if (profileUnifiedRef) profileUnifiedRef.value = r.voice.id;
    window.miku.send(Ipc.SETTINGS_UPDATE, {
      ttsVoiceId: r.voice.id,
      voiceProfiles: localSettings?.voiceProfiles,
    });
    window.miku.send(Ipc.PREVIEW_VOICE, r.voice.id);
  } else {
    if (studioStatus) {
      studioStatus.style.display = "block";
      studioStatus.style.background = "rgba(255,107,138,0.25)";
      studioStatus.style.color = "#ff6b8a";
      studioStatus.textContent = "❌ 등록 실패: " + (r?.error || "알 수 없는 오류");
    }
  }
});

// --- Character Voice Profile Management Logic (Unified Single Voice Mode) ---
const activeVoiceProfileSelect = document.getElementById("activeVoiceProfileSelect") as HTMLSelectElement | null;
const btnAddProfile = document.getElementById("btn-add-profile") as HTMLButtonElement | null;

function populateVoiceProfiles(profiles: CharacterVoiceProfile[], activeId?: string) {
  if (!activeVoiceProfileSelect) return;
  activeVoiceProfileSelect.innerHTML = "";
  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.displayName} (${p.id})`;
    if (p.id === activeId) opt.selected = true;
    activeVoiceProfileSelect.appendChild(opt);
  }
  const current = profiles.find((p) => p.id === (activeId || activeVoiceProfileSelect.value));
  if (current) {
    updateProfileFields(current);
  }
}

function updateProfileFields(profile: CharacterVoiceProfile) {
  const eng = profile.preferredEngine?.default || profile.preferredEngine?.ko || profile.preferredEngine?.ja || "fish";
  if (profileUnifiedEngine) profileUnifiedEngine.value = eng;
  if (profileUnifiedRef) {
    if (eng === "fish") {
      profileUnifiedRef.value = profile.fish?.referenceId || profile.fish?.koReferenceId || profile.fish?.jaReferenceId || localSettings?.fishVoiceId || "";
    } else if (eng === "voxcpm") {
      profileUnifiedRef.value = profile.voxcpm?.defaultReferenceWav || profile.voxcpm?.koReferenceWav || profile.voxcpm?.jaReferenceWav || localSettings?.ttsVoiceId || "";
    } else if (eng === "irodori") {
      profileUnifiedRef.value = profile.irodori?.loraId || localSettings?.irodoriLoraId || "Nilou3000";
    } else {
      profileUnifiedRef.value = "";
    }
  }
  updateProfileVoiceBadge();
}

function syncCurrentProfileFromUi() {
  if (!localSettings || !activeVoiceProfileSelect) return;
  const activeId = activeVoiceProfileSelect.value;
  const list = localSettings.voiceProfiles || [];
  const idx = list.findIndex((p) => p.id === activeId);
  if (idx < 0) return;

  const p = list[idx];
  const eng = (profileUnifiedEngine?.value || "fish") as any;
  const ref = profileUnifiedRef?.value.trim() || "";

  p.preferredEngine = {
    ...p.preferredEngine,
    default: eng,
    ko: eng,
    ja: eng,
    en: eng,
  };

  if (!p.voxcpm) p.voxcpm = {};
  if (!p.fish) p.fish = {};

  if (eng === "fish" && ref) {
    p.fish.referenceId = ref;
    p.fish.koReferenceId = ref;
    p.fish.jaReferenceId = ref;
    localSettings.fishVoiceId = ref;
    if (fishVoiceIdInput) fishVoiceIdInput.value = ref;
    localStorage.setItem("fishVoiceId", ref);
    updateFishVoiceTitleBadge();
    renderFavorites();
  } else if (eng === "voxcpm" && ref) {
    p.voxcpm.defaultReferenceWav = ref;
    p.voxcpm.koReferenceWav = ref;
    p.voxcpm.jaReferenceWav = ref;
    localSettings.ttsVoiceId = ref;
    if (voiceSel) voiceSel.value = ref;
  }

  // Interlock top provider
  localSettings.ttsProvider = eng;
  if (ttsProvSel) {
    ttsProvSel.value = eng;
    updateTtsProviderUi(eng);
  }

  updateProfileVoiceBadge();

  localSettings.voiceProfiles = list;
  localSettings.activeVoiceProfileId = activeId;
  window.miku.send(Ipc.SETTINGS_UPDATE, {
    voiceProfiles: list,
    activeVoiceProfileId: activeId,
    ttsProvider: eng,
    fishVoiceId: localSettings.fishVoiceId,
    ttsVoiceId: localSettings.ttsVoiceId,
  });
}

activeVoiceProfileSelect?.addEventListener("change", () => {
  if (!localSettings) return;
  const chosenId = activeVoiceProfileSelect.value;
  localSettings.activeVoiceProfileId = chosenId;
  const p = (localSettings.voiceProfiles || []).find((x) => x.id === chosenId);
  if (p) {
    updateProfileFields(p);
    const eng = p.preferredEngine?.default || p.preferredEngine?.ko || p.preferredEngine?.ja || "fish";
    localSettings.ttsProvider = eng;
    if (ttsProvSel) {
      ttsProvSel.value = eng;
      updateTtsProviderUi(eng);
    }
    if (eng === "fish") {
      const fishId = p.fish?.referenceId || p.fish?.koReferenceId || p.fish?.jaReferenceId || localSettings.fishVoiceId;
      if (fishId) {
        localSettings.fishVoiceId = fishId;
        if (fishVoiceIdInput) fishVoiceIdInput.value = fishId;
        localStorage.setItem("fishVoiceId", fishId);
        updateFishVoiceTitleBadge();
        renderFavorites();
      }
    } else if (eng === "voxcpm") {
      const voxId = p.voxcpm?.defaultReferenceWav || p.voxcpm?.koReferenceWav || p.voxcpm?.jaReferenceWav || localSettings.ttsVoiceId;
      if (voxId) {
        localSettings.ttsVoiceId = voxId;
        if (voiceSel) voiceSel.value = voxId;
      }
    }
    window.miku.send(Ipc.SETTINGS_UPDATE, {
      activeVoiceProfileId: chosenId,
      ttsProvider: eng,
      fishVoiceId: localSettings.fishVoiceId,
      ttsVoiceId: localSettings.ttsVoiceId,
    });
  }
});

profileUnifiedEngine?.addEventListener("change", () => {
  const eng = profileUnifiedEngine.value;
  if (profileUnifiedRef && localSettings) {
    if (eng === "fish") {
      profileUnifiedRef.value = localSettings.fishVoiceId || "acc8237220d8470985ec9be6c4c480a9";
    } else if (eng === "voxcpm") {
      profileUnifiedRef.value = localSettings.ttsVoiceId || "nilou";
    } else if (eng === "irodori") {
      profileUnifiedRef.value = localSettings.irodoriLoraId || "Nilou3000";
    } else {
      profileUnifiedRef.value = "";
    }
  }
  syncCurrentProfileFromUi();
});

profileUnifiedRef?.addEventListener("input", () => {
  updateProfileVoiceBadge();
});

profileUnifiedRef?.addEventListener("change", () => {
  syncCurrentProfileFromUi();
});

btnAddProfile?.addEventListener("click", () => {
  const name = prompt("새 보이스 프로필 이름을 입력하세요:", "새 캐릭터 프로필");
  if (!name || !name.trim()) return;
  if (!localSettings) return;

  const newId = "profile_" + Date.now();
  const curEng = (profileUnifiedEngine?.value || localSettings.ttsProvider || "fish") as any;
  const curFishRef = localSettings.fishVoiceId || "acc8237220d8470985ec9be6c4c480a9";
  const curVoxRef = localSettings.ttsVoiceId || "nilou";

  const newProfile: CharacterVoiceProfile = {
    id: newId,
    displayName: name.trim(),
    preferredEngine: {
      default: curEng,
      ko: curEng,
      ja: curEng,
      en: curEng,
    },
    fish: {
      referenceId: curFishRef,
      koReferenceId: curFishRef,
      jaReferenceId: curFishRef,
    },
    voxcpm: {
      defaultReferenceWav: curVoxRef,
      koReferenceWav: curVoxRef,
      jaReferenceWav: curVoxRef,
      cloneMode: "reference",
    },
  };

  const list = [...(localSettings.voiceProfiles || []), newProfile];
  localSettings.voiceProfiles = list;
  localSettings.activeVoiceProfileId = newId;

  populateVoiceProfiles(list, newId);
  window.miku.send(Ipc.SETTINGS_UPDATE, {
    voiceProfiles: list,
    activeVoiceProfileId: newId,
  });
});

btnDelProfile?.addEventListener("click", () => {
  if (!localSettings || !activeVoiceProfileSelect) return;
  const list = localSettings.voiceProfiles || [];
  if (list.length <= 1) {
    alert("최소 1개의 보이스 프로필은 유지되어야 합니다.");
    return;
  }
  const curId = activeVoiceProfileSelect.value;
  const curProfile = list.find((p) => p.id === curId);
  const name = curProfile ? curProfile.displayName : curId;
  if (!confirm(`'${name}' 프로필을 삭제하시겠습니까?`)) return;

  const nextList = list.filter((p) => p.id !== curId);
  const nextActiveId = nextList[0].id;
  localSettings.voiceProfiles = nextList;
  localSettings.activeVoiceProfileId = nextActiveId;

  populateVoiceProfiles(nextList, nextActiveId);
  window.miku.send(Ipc.SETTINGS_UPDATE, {
    voiceProfiles: nextList,
    activeVoiceProfileId: nextActiveId,
  });
});

---
name: chat-reactive-choreography
description: >-
  Rules and event choreography for synchronizing AI chat stream, emotional intent, speech cadence,
  and eye gaze behaviors with VRM 3D avatar animations and expressions.
---

# Chat Reactive Choreography for 3D AI Companions

This skill defines the reactive pipeline that connects text tokens, audio synthesis, and semantic intents to rich, nuanced 3D avatar reactions.

---

## 1. The Reactive Pipeline Overview

```
User Input / Mouse Query
       │
       ▼
[Pre-response Reaction: Thinking / Looking Away / Hand to Chin]
       │
       ▼
LLM Token Streaming (First Sentence Delta)
       │
       ▼
[Sentiment & Intent Analysis (Tags & Context Keywords)]
       │
       ├──► Expression Driver (Lerped blendshapes: happy, sad, angry, surprised, relaxed)
       ├──► Gaze Controller (Direct eye contact vs Saccadic darting vs Thoughtful look)
       └──► Gesture Engine (Dynamic keyframe action trigger + speech cadence modulation)
       │
       ▼
TTS Audio Chunk Arrival
       │
       ├──► Viseme Lip-Sync (Korean/English vowels synced to audio duration)
       └──► Speaking Gesture Cycling (Rhythmic conversational arm pulses)
```

---

## 2. Intent-Driven Reaction Mapping Matrix

Beyond basic static emotions, the avatar should react to dialog semantics:

| Semantic Trigger | Avatar Expression | Avatar Gesture | Gaze Behavior | Head Action |
| :--- | :--- | :--- | :--- | :--- |
| **Greeting** (`안녕`, `반가워`, `하이`) | `happy` (0.8) | `wave` (오른손 흔들기 + 살짝 기울임) | Direct Eye Contact | Neck tilt (+0.08 rad) |
| **Praise / Flattery** (`귀여워`, `대단해`, `최고`) | `happy` (0.9) | `shy` (양손 가슴 모으기 or 뺨 긁기) | Shy down-right glance | Head down (-0.1 rad), tilt |
| **Agreement / Understanding** (`맞아`, `그렇구나`, `알겠어`) | `relaxed` (0.7) | `nod` (정중하고 자연스러운 끄덕임) | Direct Eye Contact | Double subtle nod |
| **Thinking / Deliberation** (`음`, `생각`, `글쎄`, `어떤 것`) | `relaxed` (0.5) | `thinking` (턱 괴기, 가슴 앞 팔짱) | Drift up-left (사색 시선) | Head tilt (+0.12 rad) |
| **Celebration / Excitement** (`신나`, `와아`, `축하`, `대박`) | `happy` (1.0) | `cheer` (양손 가슴 앞 바운스) | Direct, sparkling | Upright bouncy bounce |
| **Singing / Musical** (`노래`, `멜로디`, `♪`, `🎵`) | `happy` (0.85) | `sing` (마이크 쥐는 포즈 + 리듬) | Direct + rhythmic sway | Rhythm sway |
| **Cute / Playful** (`브이`, `헤헤`, `에헤`) | `happy` (0.95) | `peace` (더블 브이 + 윙크) | Playful direct | Head tilt (-0.15 rad) |
| **Apology / Trouble** (`미안`, `곤란`, `어쩌지`) | `sad` (0.6) | `shy` or gentle bow | Looking down-left | Head dropped slightly |
| **Surprise / Astonishment** (`진짜?`, `헐`, `정말?`) | `surprised` (0.85) | `cheer` or startled step | Wide eyes, slightly pulled back | Head back (-0.08 rad) |

---

## 3. Natural Eye Gaze & Saccades (시선 생동감 제어)

A realistic avatar never stares fixedly at the camera like a camera sensor:
1. **Saccadic Darting (미세 시선 떨림)**: Every 1.5 - 3.5 seconds, eyes should dart 2-5 degrees off-center and return within 150ms.
2. **Blink-Coupled Gaze Shifts**: Whenever the avatar blinks, slightly re-orient the eye target (simulates natural human eye relocation).
3. **Thinking Look-Away**: During LLM deliberation (`isThinking`), pull the gaze away from the camera towards the ceiling or upper-left corner.
4. **Speaking Gaze Rhythm**: While speaking, humans intermittently look away (cognitive load of phrasing thoughts) and reconnect with the listener at sentence conclusions.

---

## 4. Multi-Sentence Conversational Gesture Pacing

- Do NOT interrupt a gesture mid-cadence abruptly.
- Always use smooth cross-fading (`fadeOut(0.25)` and `fadeIn(0.2)`).
- When a long sentence is being spoken, avoid static holding. Cycle conversational micro-gestures with randomized rhythm (2.5 - 3.5 seconds interval).

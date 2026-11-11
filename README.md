# 시간정하기 · Find a time

가입도 비밀번호도 없이, 링크 하나로 여러 사람의 되는 시간을 모으는 일정 맞추기 사이트입니다. 한국어·영어 화면, 시차·서머타임 처리, 달력 비교, AI 입력을 갖췄습니다. 모든 코드는 새로 작성했습니다.

**사이트: https://meet.snumood.com**

A no-signup, no-password scheduling poll ("when can everyone meet?") in Korean and English. All code is original.

---

## 할 수 있는 일

- **모임 만들기**: 이름 → 후보 날짜(또는 매주 요일) → 시간 범위 → 링크 공유
- **시간 칠하기**: 이름만 적고 되는 칸을 누르거나 끌어서 칠함. 칠하는 대로 저장
- **모두의 시간**: 되는 사람이 많을수록 진한 초록. 칸을 누르면 되는/안 되는 사람 이름
- **시차·서머타임**: 칸은 UTC로 저장하고 보는 사람 기기의 시간대로 그림. 서머타임 시작(없는 시각)·끝(두 번 오는 시각)을 날짜마다 따로 계산
- **내 달력과 비교**: 구글·애플·아웃룩에서 내보낸 `.ics`(구글은 `.zip`)를 고르면 일정이 있는 칸에 빗금. 파일은 **브라우저 안에서만** 읽고 서버로 보내지 않음
- **말로 알려 주기 (AI, 선택)**: "월요일은 종일 외래, 오후 8시 이후는 안 돼요"처럼 적거나 일정표 사진을 넣으면 AI가 안 되는 시간을 표에서 빼 줌. AI는 틀릴 수 있어 **사람이 목록을 확인해야** 칠할 수 있고, 칠한 뒤에도 확인 안내가 남음
- **시간 정하고 초대 보내기**: 모임을 만든 브라우저에는 많이 되는 시간 후보가 뜨고, 고른 시간·모임 이름·받는 사람 이메일로 구글 캘린더 '일정 만들기' 화면을 엶. 만든 사람이 자기 구글 계정으로 저장하면 구글이 초대를 보냄. 정한 시간·이메일은 이 서버로 보내지 않음
- **한국어/영어**: 접속 국가(Cloudflare `CF-IPCountry`, KR → 한국어)나 브라우저 언어로 고르고, 화면 위에서 바꿀 수 있음
- **밝게/어둡게** 화면

## Features (English)

Create a poll (dates or weekly days, time range, time zone) → share the link → people add a name and paint the times that work. Time zones and daylight-saving changes are handled per date. Optional: compare with your own calendar (`.ics` read only in the browser), or describe your busy times in words or a photo and let an AI mark them (you must review before applying). The poll creator gets suggested best times and a one-click link that opens Google Calendar's event editor (title, time, guests) so invites go out from their own Google account; nothing is sent to this server. Korean and English UI.

## 실행

Python 3.9 이상 표준 라이브러리만 씁니다. 빌드 단계는 없습니다.

```bash
python3 server.py                  # http://127.0.0.1:8094
python3 tests/test_server.py       # 서버 시험
```

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `MEET_PORT` / `MEET_HOST` | `8094` / `127.0.0.1` | 듣는 곳 |
| `MEET_DATA` | `./data` | 모임 JSON 파일 폴더 |
| `MEET_TRUST_PROXY` | (꺼짐) | `1`이면 `CF-Connecting-IP`·`CF-IPCountry`를 믿음. Cloudflare 뒤에서만 켜세요 |
| `MEET_KEEP_DAYS` | `365` | 이 기간 아무도 고치지 않은 모임은 지움 |
| `MEET_AI_URL`, `MEET_AI_KEY` | (없음) | AI 중계 주소와 키. 없으면 AI 기능은 꺼짐 |
| `MEET_AI_KEY_HEADER` | `X-Relay-Key` | 키를 보낼 헤더 이름 |
| `MEET_AI_MODEL` / `MEET_AI_EFFORT` | `gpt-6-luna` / `high` | 중계에 넘기는 모델·추론 강도 |
| `MEET_AI_DAILY` / `MEET_AI_PER_IP` | `99` / `10` | 하루 AI 사용 한도(사이트 전체 / IP당, 한국 날짜 기준) |

운영 예시는 [`deploy/meet.service.example`](deploy/meet.service.example)(systemd)을 보세요. 앞에 HTTPS 프록시를 두고 이 서버는 `127.0.0.1`에만 엽니다.

## AI 중계

AI 기능은 이 저장소에 들어 있지 않은 별도 중계 서버로 요청을 보냅니다. 서버는 다음 JSON을 `POST MEET_AI_URL`로 보냅니다(헤더 `MEET_AI_KEY_HEADER: MEET_AI_KEY`).

```json
{"raw_prompt": "...", "images": [{"mime": "image/jpeg", "b64": "..."}],
 "no_fallback": true, "model": "gpt-6-luna", "effort": "high"}
```

중계는 OpenAI 채팅 응답 모양 `{"choices":[{"message":{"content":"<JSON 문자열>"}}]}`으로 답하면 됩니다. 답의 JSON은 `{"busy":[{"key":"YYYY-MM-DD","start":"HH:MM","end":"HH:MM","why":"..."}],"note":"..."}`이고, 서버가 후보 날짜·시간 창 밖의 값을 걸러 냅니다. 429·503은 "바쁨"으로 보고 그 요청은 하루 한도에서 되돌립니다.

## 개인정보

- 모임에는 모임 이름, 칸, 참여자가 적은 이름과 칠한 칸만 저장합니다. 계정·이메일·비밀번호는 없습니다.
- 링크를 아는 사람은 누구나 어떤 이름으로든 고칠 수 있습니다(엑셀 공유 파일과 같은 방식).
- 달력 파일은 브라우저 안에서만 읽습니다.
- AI 기능에 적은 글·사진은 중계를 거쳐 AI 제공자에게 보내지며, 이 서버의 디스크·로그에는 남기지 않습니다(로그에는 건수만).

## 라이선스

코드는 [MIT](LICENSE). `fonts/`의 Pretendard는 [SIL Open Font License 1.1](fonts/OFL.txt) (© Kil Hyung-jin; Source © Adobe, Inter © The Inter Project Authors, M PLUS 1 © The M+ FONTS Project Authors — 자세한 고지는 OFL.txt).

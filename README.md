# 어묵 경쟁사 광고·반응 모니터

국내 어묵 카테고리 경쟁사 8곳(고래사어묵, 미도어묵, 효성어묵, 환공어묵, 부산어묵 관련 브랜드, 대림선, 사조오양, CJ 삼호어묵)의 **광고 운영 현황**과 **SNS·고객 반응**을 매일 한국 시간 오전 9시에 모아 GitHub Pages 한 주소에서 보여줍니다. PC가 꺼져 있어도 GitHub 서버에서 실행됩니다.

대상 매체: 네이버 · 메타 · 구글 (카카오·쿠팡 등은 제외)

## 무엇이 자동이고 무엇이 수동인가

| 매체 | 자동 수집 (공식 API) | 수동 등록 (자동 수집 불가·약관상 금지) |
|---|---|---|
| 네이버 | 뉴스·블로그·카페 언급, 키워드 기반 긍정/부정·이슈 분류 | 브랜드검색 PC/MO, 파워링크, 쇼핑검색광고, GFA |
| 메타 | 공식 인스타그램 게시물·좋아요·댓글 수 (토큰 설정 시) | 페이스북·인스타그램 광고(광고 라이브러리) |
| 구글 | 공식 유튜브 영상·조회수·댓글 반응, 브랜드 언급 영상 | 검색·디스플레이·유튜브 광고(광고 투명성 센터) |

근거는 대시보드 **수집 현황** 탭과 `data/coverage.json`에 있습니다. 요약:
- `search.naver.com/robots.txt`는 모든 봇을 차단합니다. 네이버 검색광고 API는 내 계정 데이터만 줍니다.
- Facebook·Instagram은 서면 허가 없는 자동 수집을 금지합니다. 공개 Ad Library API는 한국 상업 광고를 제공하지 않습니다.
- 구글 광고 투명성 센터는 공식 API가 없고, BigQuery 공개 데이터는 EEA·튀르키예 광고만 담고 있습니다.

## 처음 한 번 설정

1. **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.
2. **Settings → Secrets and variables → Actions → New repository secret** 에 아래 값을 넣습니다. 넣지 않은 항목은 화면에 ‘미설정’으로 표시되고 나머지는 정상 동작합니다.

| 이름 | 발급처 | 용도 |
|---|---|---|
| `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 네이버 클라우드 콘솔 → NAVER API HUB → 앱 등록(블로그·뉴스·카페글 검색 선택) → Client ID/Secret (기존 개발자센터는 검색 API 신규 신청 불가) | 뉴스·블로그·카페 언급 |
| `YOUTUBE_API_KEY` | Google Cloud Console → YouTube Data API v3 사용 설정 → API 키 | 유튜브 언급·공식 채널 |
| `META_ACCESS_TOKEN`, `IG_USER_ID` (선택) | Meta 개발자 앱 + 내 인스타그램 비즈니스 계정 | 경쟁사 공식 인스타그램 게시물 반응 |

3. `config/brands.json`에 공식 유튜브 채널 ID(`youtubeChannelId`)와 인스타그램 계정명(`instagramUsername`)을 **직접 확인한 뒤** 채웁니다. 비워두면 해당 항목은 ‘미설정’입니다.
4. **Actions → 경쟁사 모니터링 자동 수집 → Run workflow** 로 바로 한 번 실행할 수 있습니다.

## 수동 등록

대시보드 **수동 등록** 탭에서 양식을 채우고 ‘GitHub에 등록하기’를 누르면 내용이 채워진 GitHub 새 파일 화면이 열립니다. **Commit changes** 를 누르면 1~2분 뒤 반영됩니다.

- 파일 위치: `data/manual/*.json` (한 파일에 한 건 또는 배열)
- 필수: `brand`, `media`, `confirmedDate`, `sourceUrl`, `copy` (특이사항은 `type: "note"`, `text`)
- 이미지: `data/manual/images/`에 올리고 `image: "images/파일명.jpg"`로 연결합니다. **저작권·재게시 권한이 확인된 경우에만** 올리고, 불확실하면 이미지 없이 출처 링크만 남기세요. 공개 저장소의 Pages 주소는 누구나 볼 수 있습니다.
- 같은 브랜드·매체·카피·이미지(파일 내용 기준)는 하나로 합쳐지고 확인일이 누적됩니다 → 최초/최근 확인일, 신규/기존 분류에 사용됩니다.

## 데이터 구조

| 경로 | 내용 |
|---|---|
| `data/timeseries.json` | 날짜·경쟁사별 언급 수, 긍정/부정, 검색 총건수, 채널 지표 (일별 누적) |
| `data/mentions/YYYY-MM.json` | 수집된 언급 원본(제목·요약·출처 URL), 월별 |
| `data/official.json` | 공식 유튜브·인스타그램 콘텐츠와 날짜별 지표 이력 |
| `data/manual/` | 수동 등록 소재·특이사항 |
| `data/logs/runs.json` | 실행 기록과 수집기별 성공/미설정/오류 메시지 |
| `data/coverage.json` | 매체별 자동 수집 가능 범위 검증 결과 |

## 로컬 실행

```
node scripts/collect.mjs   # 환경변수에 API 키가 있으면 수집
node scripts/build.mjs     # _site 폴더 생성
```

## 참고

- 긍정/부정·이슈·프로모션 분류는 `scripts/lib.mjs`의 키워드 목록 기반 추정치입니다.
- 카페 글은 API가 게시일을 주지 않아 ‘처음 수집된 날’ 기준으로 집계합니다. 첫 실행에서 받은 과거 글은 기준선으로만 저장합니다.
- GitHub 예약 실행은 서버 사정에 따라 몇 분~수십 분 늦을 수 있고, 저장소에 60일간 활동이 없으면 일시 중지됩니다(매일 데이터 커밋이 있어 보통 유지됨).

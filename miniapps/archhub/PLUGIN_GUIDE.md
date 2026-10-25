# Arch Hub 플러그인 가이드라인

Arch Hub는 **그릇(허브)** 하나와, 필요할 때 끼워 쓰는 **플러그인**으로 이루어진 건축설계 앱입니다.
허브는 모든 플러그인이 같이 쓰는 **건물 메인 데이터**와 **3D 뷰**를 갖고 있고,
플러그인은 그 데이터를 읽고, 자기 결과를 그려 넣고, 정해진 곳에만 값을 씁니다.

```
miniapps/archhub/
├─ index.html              ← 허브 화면
├─ core/                   ← 허브 본체 (플러그인에서 직접 고치지 않음)
│  ├─ geom.js              ← 기하 유틸 (ctx.geo)
│  ├─ project.js           ← 메인 데이터 저장소
│  ├─ vworld.js            ← VWORLD API (ctx.vworld)
│  ├─ scene.js             ← 3D 레이어 (ctx.scene)
│  ├─ viewer-vworld.js     ← 3D 뷰: VWORLD 지도
│  ├─ viewer-three.js      ← 3D 뷰: 간이 3D (VWORLD 못 쓸 때)
│  └─ hub.js               ← UI, 플러그인 로더
└─ plugins/
   ├─ registry.js          ← 플러그인 목록 (새 플러그인은 여기 한 줄 추가)
   ├─ _template/plugin.js  ← 복사해서 시작하는 예제
   ├─ scale-review/        ← 규모검토
   ├─ column-grid/         ← 기둥 위치 스터디
   └─ sun-study/           ← 일조 시뮬레이션
```

---

## 1. 건물 메인 데이터 (모든 플러그인의 공통 기준)

좌표는 모두 **미터**. `x` = 동쪽(+), `y` = 북쪽(+), `z` = 위(+, 1층 바닥 = 0).

| 경로 | 뜻 | 좌표계 |
|---|---|---|
| `site.address`, `site.jibun`, `site.pnu` | 주소, 지번, 필지고유번호 | |
| `site.origin` | `{lon, lat}` — 대지 좌표 (0,0) 의 위경도 (보통 필지 중심) | |
| `site.boundary` | 대지경계 `[{x,y}]` (반시계) | 대지 |
| `site.area`, `site.areaSource` | 대지면적 ㎡, 출처 | |
| `site.zoning` | `{name, bcr, far, source}` 용도지역·건폐율·용적률 한도 | |
| `site.jimok` | 지목 (대, 전, 답 …) | |
| `site.neighbors` | 주변 필지 `[{jibun, pnu, touching, boundary}]` — 도로 제외, 30m 이내, `touching` = 대지와 맞닿음 | 대지 |
| `site.demolished` | 철거(숨김)한 기존 VWORLD 건물 `TD_ID` 목록 | |
| `building.coreRatio`, `building.coreAuto` | 코어비 %(기본 20), 자동이면 코어 크기를 코어비에 맞춤 | |
| `building.floorsAbove`, `floorsBelow` | 지상·지하 층수 | |
| `building.groundFloorHeight`, `floorHeight`, `basementHeight` | 1층·기준층·지하 층고 m | |
| `building.placement` | `{x, y, rotation}` 건물 원점의 대지 위 위치, 회전(°, 반시계) = 건물 좌표의 기준축 | 대지 |
| `building.axisMode` | 기준축: `site` 대지 장변(기본) · `mass` 매스 주축 · `manual` 직접 회전. 대지경계 후퇴 형태는 원점이 매스 중심 | |
| `building.shape` | `{type, w, d, cutW, cutD, setback}` 형태 입력값 (`rect` `L` `U` `site` `custom`). `site` = 대지경계에서 setback 이상 떨어진 최대 직사각형(기준축 방향) | |
| `building.footprint` | 평면 외곽 `[{x,y}]` — **형태의 최종 결과, 플러그인은 이걸 쓰세요** | 건물 |
| `building.cores` | `[{id, x, y, w, d}]` 코어 (중심점·크기) | 건물 |
| `plugins.<id>` | 각 플러그인 전용 데이터 | |

- **대지 좌표**: 대지 기준 동/북. **건물 좌표**: 건물 중심이 (0,0), 건물 회전에 맞춰 돌아간 축.
  변환은 `ctx.geo.toSite(p, placement)`, `ctx.geo.toBuilding(p, placement)`.
- `footprint` 는 `shape.type` 이 `custom` 이 아니면 허브가 형태 입력값에서 자동으로 다시 만듭니다.
  플러그인이 자유 형태를 정하고 싶으면 `building.shape.type = 'custom'` 과 `building.footprint` 를 함께 쓰세요 (writes 선언 필요).
- 현재는 **모든 층이 같은 평면**이라고 가정합니다. `ctx.project.levels()` 로 층 목록(`name, index, z, height`)을 받으세요.

전체 예시는 허브의 **저장** 버튼으로 받은 `*.archhub.json` 파일을 열어 보면 됩니다.

---

## 2. 플러그인 만들기 — 3단계

1. `plugins/_template/` 폴더를 복사해서 `plugins/my-plugin/` 으로 이름을 바꿉니다.
2. `plugin.js` 안의 `id` 를 폴더 이름과 같게(`my-plugin`) 바꾸고 기능을 작성합니다.
3. `plugins/registry.js` 에 한 줄 추가합니다.
   ```js
   { id: 'my-plugin', name: '내 플러그인', src: 'plugins/my-plugin/plugin.js',
     glyph: '<circle cx="12" cy="12" r="7"/>',   // 홈 화면 아이콘 (24×24 SVG 선 그림), 없으면 이름 첫 글자
     description: '한 줄 설명' },
   ```
   이름은 아이콘 아래에 들어가므로 짧게(6자 안팎) 짓습니다.

개발 중에는 registry 에 넣지 않고 플러그인 홈 화면의 **+ 불러오기** 아이콘을 눌러
`plugins/my-plugin/plugin.js` 를 넣어 바로 시험할 수 있습니다.

플러그인 아이콘을 누르면 플러그인이 켜지고, 오른쪽 떠 있는 패널 전체가 그 플러그인 화면(`ctx.panel`)이 됩니다.
‹ 버튼으로 홈에 돌아가도 플러그인은 계속 켜져 있고(아이콘 아래 파란 점), 화면 위의 **끄기**로 끕니다.

### 플러그인 파일의 모양

```js
ArchHub.registerPlugin({
    id: 'my-plugin',          // 영문 소문자·숫자·하이픈
    name: '내 플러그인',
    version: '0.1.0',
    apiVersion: 1,            // 허브 API 버전
    writes: ['site.zoning'],  // 메인 데이터 중 바꿀 경로 (없으면 [])

    activate(ctx) {
        // ctx.panel 에 UI 를 붙이고, ctx.scene 에 그리고, ctx.project 로 읽고 씀
        return { deactivate() { /* 끌 때 추가 정리 (선택) */ } };
    }
});
```

---

## 3. ctx — 플러그인이 받는 도구 상자

| 이름 | 하는 일 |
|---|---|
| `ctx.panel` | 오른쪽 탭 안의 내 영역(div). UI 는 여기에만 붙임 |
| `ctx.project.get(path)` | 메인 데이터 읽기 (복사본이 오므로 고쳐도 원본은 안 바뀜) |
| `ctx.project.set(path, value)` / `patch({path: value, …})` | 쓰기 — **writes 에 선언한 경로만** 가능 |
| `ctx.project.onChange(ev => …)` | 데이터가 바뀔 때. `ev.touches('building')`, `ev.source`(누가 바꿨는지) |
| `ctx.project.metrics()` | 건축면적, 연면적, 높이, 건폐율, 용적률 등 집계 |
| `ctx.project.levels()` | 층 목록 |
| `ctx.data.get()` / `set(obj)` / `update(fn)` | 내 전용 데이터(`plugins.<id>`) — 프로젝트 파일에 같이 저장됨 |
| `ctx.scene.layer(name, {frame})` | 3D 레이어. `frame: 'building'` 이면 건물 좌표 (건물 이동·회전에 따라감) |
| `ctx.geo` | 면적, 중심, 포함 판정, 볼록껍질, 후퇴(inset), 좌표 변환, 위경도↔미터 |
| `ctx.vworld` | `geocode`, `parcelAt`, `zoningAt`, `landCharacteristics`, `features`, `jsonp` |
| `ctx.ui.h(tag, attrs, …children)` | DOM 만들기 도우미, `ctx.ui.toast(msg)`, `ctx.ui.fmt(n)` |
| `ctx.bus.emit(type, data)` / `on(type, fn)` | 플러그인끼리 신호 주고받기 (예: `'columns:changed'`) |

### 3D 레이어

```js
const L = ctx.scene.layer('columns', { frame: 'building' });
L.clear();
L.extrude(poly, { base: 0, height: 30, color: '#3b5bdb', opacity: 1 });  // 수직 돌출
L.polygon(poly, { z: 0.2, color: '#1b2a4a', opacity: 0.3 });            // 수평 면
L.line(points, { z: 0.3, color: '#d6452f', closed: true });             // 선
L.label({ x, y, z }, '텍스트', { color: '#15171c' });                    // 글자
```

레이어는 VWORLD 3D / 간이 3D 어느 쪽에서도 똑같이 보입니다. 플러그인은 3D 엔진(Cesium, Three.js)을 직접 쓰지 않습니다.

---

## 4. 꼭 지킬 규칙

1. **메인 데이터는 writes 에 선언한 경로만 바꾼다.** 선언 없이 쓰면 허브가 막고 오류를 띄웁니다.
2. **내 결과는 `ctx.data` 에 저장한다.** 다른 플러그인이 읽을 수 있게 `plugins.<id>` 구조를 설명 주석으로 남깁니다.
   (예: 기둥 스터디 → `plugins['column-grid'].columns = [{x, y, grid}]` — 주차 계획이 읽어 쓸 수 있음)
3. **무한 반복 방지**: `onChange` 안에서 데이터를 쓴다면 `ev.source !== ctx.id` 일 때만 다시 계산하고, 값이 실제로 바뀔 때만 저장합니다.
4. **UI 는 `ctx.panel` 안에만.** 허브 화면의 다른 요소를 건드리지 않습니다. 공통 클래스(`sec`, `field`, `btn`, `btn ghost`, `btn small`, `btn text`, `hint`, `row`, `grid2`, `grid3`, `bar`)를 쓰면 허브의 Apple Inspiration 디자인 시스템 모양(SF Pro, 파란 알약 버튼 하나, 회색 입력칸)과 맞춰집니다. 파란 채움 버튼(`btn`)은 한 화면 구역에 하나만 씁니다.
5. **3D 는 `ctx.scene` 레이어로만.** 이름은 자동으로 `<id>/<name>` 이 되고, 플러그인을 끄면 허브가 지웁니다.
6. **외부 API 키·비밀번호를 파일에 넣지 않는다.** 이 저장소는 공개입니다. 비밀 키가 필요한 API(예: 법제처 Open API 의 OC)는 Supabase Edge Function 을 거쳐 호출합니다.
7. **오류는 삼키지 말고 알린다.** `ctx.ui.toast(msg, 'error')`. 플러그인 오류는 허브가 잡아서 다른 플러그인에 번지지 않게 합니다.
8. 데이터 구조를 바꾸면 `version` 을 올리고, 예전 `ctx.data` 를 읽을 수 있게 처리합니다.

---

## 5. 앞으로 만들 플러그인 아이디어와 데이터 연결

| 플러그인 | 읽는 것 | 쓰는 것 |
|---|---|---|
| 규모검토 ✅ | site, building, metrics | `site.area`, `site.zoning` |
| 기둥 위치 스터디 ✅ | footprint, cores, levels | `plugins.column-grid.columns` |
| 일조 시뮬레이션 ✅ | site.origin, footprint, 높이 | (그리기만) |
| 코어 구획 구체화 | cores, floorsAbove, metrics | `building.cores` (계단·EV 세부는 `plugins.core-detail`) |
| 입면 모듈화 | footprint, levels | `plugins.facade` (변별 모듈 폭, 패널 타입) |
| 주차장 계획 | footprint, floorsBelow, `plugins.column-grid.columns` | `plugins.parking` (대수, 배치) |
| 정북 일조 사선 | site.boundary, zoning | (그리기만) |

---

## 6. 확인 목록 (배포 전)

- [ ] 허브에서 켜고 끄기를 여러 번 반복해도 오류가 없다 (끄면 3D·UI 가 깨끗이 사라짐)
- [ ] 왼쪽 메인 데이터(층수, 형태, 회전)를 바꾸면 내 결과도 따라 바뀐다
- [ ] 저장 → 새로 → 열기 후에도 내 설정이 돌아온다
- [ ] VWORLD 3D 와 간이 3D 양쪽에서 보인다
- [ ] 브라우저 콘솔(F12)에 빨간 오류가 없다

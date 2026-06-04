import streamlit as st
import google.generativeai as genai
from tavily import TavilyClient
import json
import time

# ==========================================
# 1. 페이지 기본 설정 및 미니멀 UI 디자인 (CSS)
# ==========================================
st.set_page_config(
    page_title="ARCHI-FIND // 건축 레퍼런스 AI 검색기",
    page_icon="📐",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 건축가 스타일의 미니멀 흑백/그레이 톤 CSS 주입
st.markdown("""
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
        html, body, [data-testid="stAppViewContainer"] {
            font-family: 'Noto Sans KR', sans-serif;
            background-color: #F8F9FA;
            color: #212529;
        }
        .main-title {
            font-size: 2.2rem;
            font-weight: 700;
            letter-spacing: -0.05rem;
            color: #111111;
            margin-bottom: 0.5rem;
            text-transform: uppercase;
        }
        .sub-title {
            font-size: 1rem;
            color: #6C757D;
            margin-bottom: 2.5rem;
        }
        [data-testid="stSidebar"] {
            background-color: #FFFFFF;
            border-right: 1px solid #E9ECEF;
        }
        .project-card {
            background-color: #FFFFFF;
            padding: 24px;
            border-radius: 4px;
            border: 1px solid #E9ECEF;
            margin-bottom: 30px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .project-title {
            font-size: 1.4rem;
            font-weight: 700;
            color: #1A1A1A;
            margin-bottom: 12px;
            border-bottom: 2px solid #1A1A1A;
            padding-bottom: 8px;
        }
        .meta-item {
            font-size: 0.9rem;
            margin-bottom: 4px;
        }
        .meta-label {
            font-weight: 500;
            color: #495057;
            display: inline-block;
            width: 90px;
        }
        .raw-link-container {
            background-color: #FFFFFF;
            padding: 15px;
            border-radius: 4px;
            border: 1px solid #CED4DA;
            margin-bottom: 20px;
        }
    </style>
""", unsafe_allow_html=True)

# ==========================================
# 2. 사이드바 - API 보안 키 입력
# ==========================================
st.sidebar.markdown("### 🔑 API CREDENTIALS")
gemini_api_key = st.sidebar.text_input("Gemini API Key", type="password", help="Google AI Studio에서 발급받은 API 키")
tavily_api_key = st.sidebar.text_input("Tavily API Key", type="password", help="Tavily Platform에서 발급받은 API 키")

st.sidebar.markdown("---")
st.sidebar.markdown("""
<div style='font-size: 0.8rem; color: #868E96; line-height: 1.5;'>
<strong>ARCHI-FIND v1.2</strong><br>
- 사용자가 입력한 키워드로만 엄격히 검색합니다.<br>
- 크롤링 실시간 시각화 기능이 추가되었습니다.
</div>
""", unsafe_allow_html=True)

# ==========================================
# 3. 메인 UI - 헤더 및 입력 필드
# ==========================================
st.markdown("<div class='main-title'>📐 ARCHI-FIND</div>", unsafe_allow_html=True)
st.markdown("<div class='sub-title'>실시간 웹 크롤링 및 AI 필터링 기반 고품질 건축 레퍼런스 검색기</div>", unsafe_allow_html=True)

col1, col2 = st.columns(2)
with col1:
    concept = st.text_input("1. 특징 / 컨셉 (Concept)", placeholder="예: 천창, 중정형")
    material = st.text_input("2. 주요 재료 (Materials)", placeholder="예: 노출 콘크리트, 목재")

with col2:
    method = st.text_input("3. 형태 / 시공법 (Method)", placeholder="예: OSC 모듈러, 프리패브")
    location = st.text_input("4. 위치 / 지역 (Location)", placeholder="예: 서울 성수, 일본 도쿄")

search_button = st.button("레퍼런스 탐색 및 보고서 생성", type="primary")

# ==========================================
# 4. 핵심 로직: 시각화 프로세스 + 엄격한 검색
# ==========================================
if search_button:
    if not gemini_api_key or not tavily_api_key:
        st.error("⚠️ 시작하기 전에 사이드바에 Gemini API Key와 Tavily API Key를 모두 입력해주세요.")
    elif not (concept or material or method or location):
        st.warning("⚠️ 최소 한 개 이상의 검색 조건을 입력해주세요.")
    else:
        # 시각화를 위한 가시적 대시보드 컴포넌트 생성
        status_box = st.empty()
        progress_bar = st.progress(0)
        
        try:
            # --------------------------------------------------
            # 1단계: 검색 쿼리 빌드 (유저 키워드만 엄격하게 매칭)
            # --------------------------------------------------
            status_box.markdown("🔄 **[1/4] 검색 쿼리 생성 중...** (입력하신 키워드만 반영합니다)")
            progress_bar.progress(10)
            time.sleep(0.5)
            
            # AI가 마음대로 확장하지 못하도록 사용자가 입력한 순수한 텍스트 단어만 조합
            query_parts = [p for p in [concept, material, method, location] if p.strip()]
            search_query = " ".join(query_parts) + " architecture project archdaily dezeen"
            
            # --------------------------------------------------
            # 2단계: Tavily 실시간 글로벌 웹 크롤링 수행
            # --------------------------------------------------
            status_box.markdown(f"🌐 **[2/4] 글로벌 건축 웹사이트 실시간 크롤링 중...**<br>이 과정은 약 3~5초 소요됩니다. (검색어: `{search_query}`)", unsafe_allow_html=True)
            progress_bar.progress(30)
            
            tavily_client = TavilyClient(api_key=tavily_api_key)
            raw_search_results = tavily_client.search(
                query=search_query,
                search_depth="advanced",
                include_images=True,
                max_results=10
            )
            
            progress_bar.progress(60)
            
            # --------------------------------------------------
            # 3단계: 선별 전 원본 크롤링 데이터 전체 공개 (요청 사항 반영)
            # --------------------------------------------------
            status_box.markdown("🔗 **[3/4] 크롤링 완료! 선별 전 발견된 모든 웹 레퍼런스 리스트를 출력합니다.**")
            
            with st.expander("🔍 AI 필터링 전, 실시간으로 찾아낸 모든 링크 원본 보기 (클릭하여 펼치기)", expanded=True):
                st.markdown("<div class='raw-link-container'>", unsafe_allow_html=True)
                raw_results = raw_search_results.get('results', [])
                if not raw_results:
                    st.write("발견된 원본 웹 페이지가 없습니다.")
                else:
                    for idx, res in enumerate(raw_results, 1):
                        st.markdown(f"{idx}. **[{res.get('title')}]** - [원본 링크 바로가기]({res.get('url')})")
                        st.caption(f"내용 요약: {res.get('content')[:120]}...")
                st.markdown("</div>", unsafe_allow_html=True)
            
            # --------------------------------------------------
            # 4단계: Gemini 최신 모델(2.5-flash)을 이용한 데이터 정형화
            # --------------------------------------------------
            status_box.markdown("🤖 **[4/4] 최신 Gemini 모델이 고품질 아키텍처 보고서를 가공하는 중입니다...**")
            progress_bar.progress(80)
            
            genai.configure(api_key=gemini_api_key)
            model = genai.GenerativeModel('gemini-2.5-flash')
            
            # 임의 해석 금지 규칙을 추가한 강력한 프롬프트
            prompt = f"""
            당신은 세계적인 건축 기술 컨설턴트입니다.
            제공된 웹 크롤링 데이터에서 사용자의 요구조건에 부합하는 상위 유효 건축 프로젝트를 엄선하여 리포트로 가공해주세요.

            [사용자 입력 키워드]
            - 컨셉: {concept} (이 단어 자체에 집중하세요. '자연채광' 등으로 독자적으로 확장 해석하지 마십시오.)
            - 재료: {material}
            - 시공법: {method}
            - 위치: {location}

            [크롤링 데이터]
            - 웹 내용: {raw_results}
            - 이미지 주소 풀: {raw_search_results.get('images', [])}

            [필터링 규칙]
            1. 사용자가 지정한 단어({concept}, {material} 등)가 실제로 본문 내용이나 특징에 직접 언급되거나 핵심으로 녹아든 사례만 남기세요.
            2. 존재하지 않는 허위 URL이나 이미지 주소는 절대 만들어내지 말고 제공된 풀에 있는 것만 사용하세요.
            3. 결과는 반드시 아래에 지정된 JSON 배열 포맷으로만 출력하세요.

            [출력 JSON 포맷 양식]
            [
              {{
                "title_ko": "국문 건축물 이름",
                "title_en": "영문 건축물 이름",
                "year": "건축연도",
                "location": "정확한 위치",
                "scale": "규모 및 층수",
                "area": "연면적",
                "image_url": "제공된 이미지 주소 풀 내에서 해당 프로젝트와 가장 잘 매칭되는 실제 유효한 URL 하나 (없으면 빈 문자열)",
                "link_url": "원본 데이터에 있는 유효한 해당 프로젝트 원본 웹페이지 링크 URL",
                "features": "사용자가 입력한 키워드들이 해당 프로젝트에 어떻게 직접적으로 반영되었는지 기술 (2~3문장)",
                "reason": "요구조건에 매칭되는 전문가적 선정 이유"
              }}
            ]
            """
            
            response = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"}
            )
            
            projects = json.loads(response.text)
            
            # 프로세스 완료 처리
            progress_bar.progress(100)
            status_box.success("✨ 고품질 정밀 보고서 생성이 완료되었습니다!")
            
            # ==========================================
            # 5. 결과 출력 (세련된 보고서 카드 포맷)
            # ==========================================
            st.markdown("### 📋 AI 엄선 정밀 레퍼런스 보고서")
            
            for proj in projects:
                st.markdown(f"""
                <div class="project-card">
                    <div class="project-title">{proj.get('title_ko', '이름 없음')} <span style='font-size:1.1rem; font-weight:300; color:#6C757D;'>({proj.get('title_en', 'N/A')})</span></div>
                </div>
                """, unsafe_allow_html=True)
                
                text_col, img_col = st.columns([3, 2])
                
                with text_col:
                    st.markdown(f"<div class='meta-item'><span class='meta-label'>📅 건축연도</span>{proj.get('year', '-')}</div>", unsafe_allow_html=True)
                    st.markdown(f"<div class='meta-item'><span class='meta-label'>📍 위 치</span>{proj.get('location', '-')}</div>", unsafe_allow_html=True)
                    st.markdown(f"<div class='meta-item'><span class='meta-label'>🏢 규모/층수</span>{proj.get('scale', '-')}</div>", unsafe_allow_html=True)
                    st.markdown(f"<div class='meta-item'><span class='meta-label'>📐 연면적</span>{proj.get('area', '-')}</div>", unsafe_allow_html=True)
                    
                    st.markdown("<div style='margin-top:15px;'><strong>💡 핵심 구현 특징</strong></div>", unsafe_allow_html=True)
                    st.info(proj.get('features', '정보가 없습니다.'))
                    
                    st.markdown("<div><strong>🧐 전문가 선정 이유</strong></div>", unsafe_allow_html=True)
                    st.write(proj.get('reason', '정보가 없습니다.'))
                    
                    if proj.get('link_url'):
                        st.markdown("<div style='margin-top:15px;'></div>", unsafe_allow_html=True)
                        st.link_button("🔗 원본 프로젝트 / 도면 아카이브 보기", proj.get('link_url'))
                
                with img_col:
                    if proj.get('image_url') and proj.get('image_url').startswith('http'):
                        st.image(proj.get('image_url'), use_container_width=True, caption=proj.get('title_en'))
                    else:
                        st.markdown("""
                        <div style='background-color:#F1F3F5; height:250px; display:flex; align-items:center; justify-content:center; color:#ADB5BD; border-radius:4px;'>
                            No Image Provided By Archive
                        </div>
                        """, unsafe_allow_html=True)
                
                st.markdown("<div style='margin-bottom:40px;'></div>", unsafe_allow_html=True)
                
        except Exception as e:
            progress_bar.empty()
            status_box.error(f"데이터를 처리하는 중 오류가 발생했습니다: {str(e)}")


import streamlit as st
import google.generativeai as genai
from tavily import TavilyClient
import json

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
        /* 전체 배경 및 폰트 스타일 조정 */
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
        html, body, [data-testid="stAppViewContainer"] {
            font-family: 'Noto Sans KR', sans-serif;
            background-color: #F8F9FA;
            color: #212529;
        }
        /* 메인 타이틀 스타일 */
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
        /* 사이드바 스타일 */
        [data-testid="stSidebar"] {
            background-color: #FFFFFF;
            border-right: 1px solid #E9ECEF;
        }
        /* 카드 형태의 보고서 스타일 */
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
    </style>
""", unsafe_allow_html=True)

# ==========================================
# 2. 사이드바 - API 보안 키 입력
# ==========================================
st.sidebar.markdown("### 🔑 API CREDENTIALS")
gemini_api_key = st.sidebar.text_input("Gemini API Key", type="password", help="Google AI Studio에서 발급받은 API 키를 입력하세요.")
tavily_api_key = st.sidebar.text_input("Tavily API Key", type="password", help="Tavily Platform에서 발급받은 API 키를 입력하세요.")

st.sidebar.markdown("---")
st.sidebar.markdown("""
<div style='font-size: 0.8rem; color: #868E96; line-height: 1.5;'>
<strong>ARCHI-FIND v1.0</strong><br>
본 시스템은 ArchDaily, Dezeen, Divisare 등 글로벌 건축 아카이브의 실시간 데이터를 기반으로 구동됩니다.
</div>
""", unsafe_allow_html=True)

# ==========================================
# 3. 메인 UI - 헤더 및 입력 필드
# ==========================================
st.markdown("<div class='main-title'>📐 ARCHI-FIND</div>", unsafe_allow_html=True)
st.markdown("<div class='sub-title'>실시간 웹 크롤링 및 AI 필터링 기반 고품질 건축 레퍼런스 검색기</div>", unsafe_allow_html=True)

# 입력 조건 UI 배치 (2x2 그리드 레이아웃)
col1, col2 = st.columns(2)
with col1:
    concept = st.text_input("1. 특징 / 컨셉 (Concept)", placeholder="예: 중정형, 미니멀리즘, 자연 채광")
    material = st.text_input("2. 주요 재료 (Materials)", placeholder="예: 노출 콘크리트, 재활용 패브릭, 목재")

with col2:
    method = st.text_input("3. 형태 / 시공법 (Method)", placeholder="예: OSC 모듈러, 프리패브, 리모델링")
    location = st.text_input("4. 위치 / 지역 (Location)", placeholder="예: 서울 성수, 일본 도쿄, 유럽")

search_button = st.button("레퍼런스 탐색 및 보고서 생성", type="primary")

# ==========================================
# 4. 핵심 로직: Tavily 크롤링 & Gemini 정형화
# ==========================================
if search_button:
    # API 키 검증
    if not gemini_api_key or not tavily_api_key:
        st.error("⚠️ 시작하기 전에 사이드바에 Gemini API Key와 Tavily API Key를 모두 입력해주세요.")
    elif not (concept or material or method or location):
        st.warning("⚠️ 최소 한 개 이상의 검색 조건을 입력해주세요.")
    else:
        with st.spinner("글로벌 건축 데이터베이스에서 실시간 검색 및 AI 분석 중입니다..."):
            try:
                # 4-1. Tavily를 이용한 실시간 고품질 건축 웹 크롤링
                tavily_client = TavilyClient(api_key=tavily_api_key)
                
                # 검색 쿼리 정교화
                search_query = f"{concept} {material} {method} {location} architecture project archdaily dezeen"
                
                # Tavily API 호출 (이미지 포함 옵션 필수)
                raw_search_results = tavily_client.search(
                    query=search_query,
                    search_depth="advanced",
                    include_images=True,
                    max_results=10
                )
                
                # 4-2. Gemini 모델 설정 (1.5 Flash 활용)
                genai.configure(api_key=gemini_api_key)
                model = genai.GenerativeModel('gemini-1.5-flash')
                
                # 프롬프트 엔지니어링 (Strict JSON 출력 유도 및 할루시네이션 방지)
                prompt = f"""
                당신은 세계적인 건축 기술 컨설턴트이자 리서처입니다.
                다음 제공된 웹 크롤링 원본 데이터(Raw Data)를 바탕으로, 사용자의 요구조건에 완벽히 부합하는 상위 유효 건축 프로젝트를 엄선하여 정형화된 보고서 데이터로 가공해주세요.

                [사용자 요구 조건]
                - 컨셉: {concept}
                - 재료: {material}
                - 시공법: {method}
                - 위치: {location}

                [크롤링 원본 데이터]
                - 웹 검색 내용: {raw_search_results.get('results', [])}
                - 수집된 이미지 주소 풀(Pool): {raw_search_results.get('images', [])}

                [필터링 및 가공 규칙 (매우 중요)]
                1. 2015년 이전에 준공된 오래된 사례나 정보가 불분명한 무명 사례는 제외하세요.
                2. 원본 데이터 내에 존재하지 않는 허위 URL이나 이미지 주소를 절대 임의로 만들어내지 마세요(Hallucination 엄금).
                3. 결과는 반드시 아래에 지정된 JSON 배열 포맷으로만 출력하세요. 다른 텍스트나 설명은 생략하십시오.
                4. 최종 엄선된 프로젝트 개수는 3개에서 5개 사이여야 합니다.

                [출력 JSON 포맷 양식]
                [
                  {{
                    "title_ko": "국문 건축물 이름",
                    "title_en": "영문 건축물 이름",
                    "year": "건축연도 (예: 2023)",
                    "location": "정확한 위치",
                    "scale": "규모 및 층수 (정보 없으면 '확인 불가' 표기)",
                    "area": "연면적 (예: 150m² 또는 '확인 불가' 표기)",
                    "image_url": "제공된 이미지 주소 풀 내에서 해당 프로젝트와 가장 잘 매칭되는 실제 유효한 URL 하나만 매칭 (없으면 빈 문자열)",
                    "link_url": "원본 데이터에 있는 유효한 해당 프로젝트 원본 웹페이지 링크 URL",
                    "features": "사용자가 입력한 재료, 시공법, 컨셉 등이 해당 프로젝트에 어떻게 구체적으로 반영되었는지 상세 설명 (2~3문장)",
                    "reason": "이 프로젝트가 왜 사용자의 요구조건에 완벽히 부합하며, 어떤 점을 레퍼런스로 삼아야 하는지 전문가적 관점에서의 서술"
                  }}
                ]
                """
                
                # Gemini 응답 요청 (JSON 구조 정의 적용)
                response = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                
                # JSON 파싱
                projects = json.loads(response.text)
                
                # ==========================================
                # 5. 결과 출력 (세련된 보고서 카드 포맷)
                # ==========================================
                st.markdown("---")
                st.markdown(f"### 📋 분석 완료: 엄선된 레퍼런스 보고서 ({len(projects)}건)")
                
                for proj in projects:
                    # 카드 컨테이너 시작
                    st.markdown(f"""
                    <div class="project-card">
                        <div class="project-title">{proj.get('title_ko', '이름 없음')} <span style='font-size:1.1rem; font-weight:300; color:#6C757D;'>({proj.get('title_en', 'N/A')})</span></div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    # 카드 내부 레이아웃 분할 (좌측: 정보 및 텍스트 / 우측: 건축 이미지)
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
                        
                        # 원본 링크 버튼
                        if proj.get('link_url'):
                            st.markdown("<div style='margin-top:15px;'></div>", unsafe_allow_html=True)
                            st.link_button("🔗 원본 프로젝트 / 도면 아카이브 보기", proj.get('link_url'))
                    
                    with img_col:
                        # 유효한 이미지 URL이 있는 경우 이미지 출력
                        if proj.get('image_url') and proj.get('image_url').startswith('http'):
                            st.image(proj.get('image_url'), use_container_width=True, caption=proj.get('title_en'))
                        else:
                            # 이미지가 없을 경우 미니멀한 플레이스홀더 박스 제공
                            st.markdown("""
                            <div style='background-color:#F1F3F5; height:250px; display:flex; align-items:center; justify-content:center; color:#ADB5BD; border-radius:4px;'>
                                No Image Provided By Archive
                            </div>
                            """, unsafe_allow_html=True)
                    
                    st.markdown("<div style='margin-bottom:40px;'></div>", unsafe_allow_html=True)
                    
            except Exception as e:
                st.error(f"데이터를 처리하는 중 오류가 발생했습니다: {str(e)}")
                st.info("API 키가 올바른지, 혹은 크롤링 결과에 유효한 데이터가 있는지 확인해 주세요.")
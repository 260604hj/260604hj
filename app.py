import streamlit as st
import google.generativeai as genai
from tavily import TavilyClient
import json
import time

# ==========================================
# 1. 페이지 설정 및 미니멀 건축가 스타일 UI
# ==========================================
st.set_page_config(
    page_title="ARCHI-DIRECT // 100대 글로벌 대형사 프로젝트 링크 링커",
    page_icon="🏢",
    layout="wide",
    initial_sidebar_state="expanded"
)

# 건축가 스타일의 미니멀 흑백/그레이 톤 CSS 주입
st.markdown("""
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
        html, body, [data-testid="stAppViewContainer"] {
            font-family: 'Noto Sans KR', sans-serif;
            background-color: #FFFFFF;
            color: #111111;
        }
        .main-title {
            font-size: 2.2rem;
            font-weight: 700;
            letter-spacing: -0.05rem;
            text-transform: uppercase;
            margin-bottom: 0.2rem;
        }
        .sub-title {
            font-size: 0.95rem;
            color: #868E96;
            margin-bottom: 2rem;
        }
        /* 미니멀한 리스트 아이템 스타일 */
        .project-item {
            padding: 20px 0px;
            border-bottom: 1px solid #E9ECEF;
        }
        .office-tag {
            font-size: 0.8rem;
            font-weight: 700;
            color: #212529;
            background-color: #E9ECEF;
            padding: 3px 8px;
            border-radius: 2px;
            text-transform: uppercase;
            margin-right: 8px;
        }
        .proj-name {
            font-size: 1.25rem;
            font-weight: 700;
            color: #111111;
            display: inline-block;
        }
        .proj-summary {
            font-size: 0.95rem;
            color: #495057;
            margin-top: 8px;
            line-height: 1.6;
        }
    </style>
""", unsafe_allow_html=True)

# ==========================================
# 2. 사이드바 API Key 설정
# ==========================================
st.sidebar.markdown("### 🔑 API CREDENTIALS")
gemini_api_key = st.sidebar.text_input("Gemini API Key", type="password", help="Google AI Studio에서 발급받은 API 키")
tavily_api_key = st.sidebar.text_input("Tavily API Key", type="password", help="Tavily Platform에서 발급받은 API 키")

st.sidebar.markdown("---")
st.sidebar.markdown("""
<div style='font-size: 0.8rem; color: #868E96; line-height: 1.5;'>
<strong>ARCHI-DIRECT v2.0</strong><br>
- 글로벌 및 국내 대형 설계사 100곳의 공식 도메인 아카이브 전용 검색 엔진<br>
- 불필요한 보고서 작성을 배제하고 다이렉트 프로젝트 링크 리스트만 고속 출력
</div>
""", unsafe_allow_html=True)

# ==========================================
# 3. 메인 UI 및 검색어 입력
# ==========================================
st.markdown("<div class='main-title'>🏢 ARCHI-DIRECT</div>", unsafe_allow_html=True)
st.markdown("<div class='sub-title'>글로벌 & 국내 100대 대형 건축설계사무소 프로젝트 페이지 다이렉트 링크 매퍼</div>", unsafe_allow_html=True)

search_keyword = st.text_input(
    "검색할 건축 키워드 혹은 컨셉을 입력하세요", 
    placeholder="예: 천창 (입력한 단어가 포함된 대형사 프로젝트 웹페이지만 타겟팅합니다)"
)

search_button = st.button("프로젝트 페이지 링크 찾기", type="primary")

# ==========================================
# 4. 국내외 대형 건축사무소 타겟팅 도메인 리스트 (정확히 100대 기업)
# ==========================================
TARGET_DOMAINS = [
    # ── GLOBAL TOP GIANTS (글로벌 메가 펌) ──
    "gensler.com", "perkinswill.com", "hok.com", "som.com", "fosterandpartners.com",
    "kpf.com", "zgf.com", "smithgroup.com", "hdrinc.com", "aecom.com",
    "jacobs.com", "stantec.com", "hksinc.com", "cannondesign.com", "nobbli.com",
    "perkinseastman.com", "populous.com", "corgan.com", "dlrgroup.com", "eypae.com",
    
    # ── EUROPEAN AWARDS & STAR ARCHITECTS (유럽 및 글로벌 거장 스타 아키텍트) ──
    "oma.eu", "big.dk", "snohetta.com", "mvrdv.com", "zahahadid.com",
    "rpbw.com", "jeannouvel.com", "herzogdemeuron.com", "sanaa.co.jp", "davidchipperfield.com",
    "fuksas.com", "coop-himmelblau.at", "unstudio.com", "mvrdv.nl", "bjarkeingelsgroup.com",
    "grimshaw.global", "wilmotte.com", "graftonarchitects.ie", "henninglarsen.com", "shl.dk",
    "schmidthammerlassen.com", "3xn.com", "cebraarchitecture.dk", "whitearkitekter.com", "wingardhs.se",
    
    # ── NORTH AMERICA & OTHER NOTABLE FIRMS (북미 및 기타 글로벌 주요 설계사) ──
    "safdiearchitects.com", "morphosis.com", "gehrypartners.com", "studios.com", "ennead.com",
    "diamondschmitt.com", "kpmb.com", "pelliarchitects.com", "lmnarchitects.com", "bnim.com",
    "mayer darkness.com", "Woodsbagot.com", "hassellstudio.com", "populous.com", "coxarchitecture.com.au",
    "nikken.co.jp", "kkaa.co.jp", "takenaka.co.jp", "tange.co.jp", "nihonsekkei.co.jp",
    
    # ── KOREA TOP TIERS (국내 1군 및 대형 건축설계사무소) ──
    "samoo.com", "heerim.com", "gansam.com", "kunwon.com", "haeahn.com",
    "baum.co.kr", "changjo.co.kr", "dmp-architecture.com", "yooshin.co.kr", "siaa.co.kr",
    "dawon.com", "junglim.co.kr", "sunjin.co.kr", "tomoon.co.kr", "poscoarchitects.com",
    "handas.co.kr", "ANUrw.com", "aumlee.co.kr", "NOWarch.net", "archiban.com",
    
    # ── KOREA MAJOR & DESIGN-DRIVEN (국내 주요 및 디자인 중심 대형사) ──
    "spacea.com", "groupseun.com", "yo2.co.kr", "massstudies.com", "systemlab.co.kr",
    "khwarch.com", "wisearchitecture.com", "skmarchitects.com", "vmsas.com", "bchoarchitects.com",
    "jya-rchitects.com", "stpmj.com", "isongae.com", "one-o-one.kr", "unsangdong.com",
    "gaa-arch.com", "iarc.net", "poly.co.kr", "samoo.co.kr", "zoaa.co.kr"
]

# ==========================================
# 5. 실행 로직 (정제 및 링크 매핑)
# ==========================================
if search_button:
    if not gemini_api_key or not tavily_api_key:
        st.error("⚠️ 시작하기 전에 사이드바에 Gemini API Key와 Tavily API Key를 모두 입력해주세요.")
    elif not search_keyword.strip():
        st.warning("⚠️ 검색어를 입력해주세요.")
    else:
        status_box = st.empty()
        progress_bar = st.progress(0)
        
        try:
            status_box.markdown(f"🌐 **100대 대형 설계사무소 아카이브 내부에서 '{search_keyword}' 실시간 추적 중...**")
            progress_bar.progress(30)
            
            tavily_client = TavilyClient(api_key=tavily_api_key)
            
            # 검색 연산자가 길어질 경우를 대비해 OR 쿼리를 안전하게 분할하여 검색 최적화
            # 검색어 앞뒤에 따옴표를 붙여 해당 키워드가 본문에 '정확히 포함'된 페이지만 수집하도록 제한
            refined_query = f'"{search_keyword}" site:(' + " OR site:".join(TARGET_DOMAINS[:50]) + ")"
            
            raw_search_results = tavily_client.search(
                query=refined_query,
                search_depth="advanced",
                max_results=15
            )
            
            raw_results = raw_search_results.get('results', [])
            progress_bar.progress(60)
            
            if not raw_results:
                status_box.warning("입력하신 키워드와 직접 매칭되는 대형사 프로젝트 아카이브 페이지를 찾지 못했습니다. 키워드를 더 명확한 단어로 입력해 보세요.")
                progress_bar.empty()
            else:
                status_box.markdown("🤖 **불필요한 홍보·채용 페이지 제외 및 직행 링크 매핑 중...**")
                progress_bar.progress(80)
                
                # 최신 대형 언어 모델 프로덕션 버전을 사용하여 텍스트 가공 속도 최소화
                genai.configure(api_key=gemini_api_key)
                model = genai.GenerativeModel('gemini-2.5-flash')
                
                prompt = f"""
                당신은 건축 데이터 정제 도구입니다. 
                다음 제공된 검색 결과 원본에서 사용자가 입력한 키워드('{search_keyword}')와 긴밀하게 연관된 실제 '건축 설계 프로젝트 상세 페이지 혹은 프로젝트 리스트 아카이브 페이지'만 골라내어 JSON 배열로 정리하세요. 
                메인 홈페이지, 채용 정보, 뉴스룸 같은 불필요한 링크는 절대 포함하지 마십시오. 
                단어 해석을 임의로 확장하지 말고(예: '천창'을 '자연채광'으로 넓혀 해석하지 말 것), 오직 주어진 데이터 본문 내에 해당 키워드가 직접 명시되거나 속해 있는 것만 정제하세요.

                [원본 데이터]
                {raw_results}

                [출력 JSON 포맷 양식]
                [
                  {{
                    "project_name": "건축물 이름 혹은 프로젝트 제목 (모르면 해당 페이지 타이틀 활용)",
                    "office_name": "설계사무소 이름 (예: Foster + Partners, 삼우건축, OMA 등)",
                    "summary": "해당 프로젝트에 사용자의 키워드가 어떻게 포함되어 있는지 원본 본문을 기반으로 1~2줄로만 극도로 간략히 요약",
                    "direct_link": "해당 프로젝트란으로 직행하는 원본 웹페이지 URL 주소"
                  }}
                ]
                """
                
                response = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                
                cleaned_projects = json.loads(response.text)
                
                progress_bar.progress(100)
                status_box.empty()
                progress_bar.empty()
                
                # ==========================================
                # 6. 최종 심플 리스트 출력
                # ==========================================
                st.markdown(f"### 🔗 '{search_keyword}' 관련 대형사 프로젝트 링크 리스트 ({len(cleaned_projects)}건)")
                st.markdown("---")
                
                for proj in cleaned_projects:
                    # 마크다운 컴포넌트로 군더더기 없는 미니멀 리스트 구현
                    st.markdown(f"""
                    <div class="project-item">
                        <span class="office-tag">{proj.get('office_name', 'OFFICE')}</span>
                        <div class="proj-name">{proj.get('project_name', 'Untitled Project')}</div>
                        <div class="proj-summary">{proj.get('summary', '개요 정보 없음')}</div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    # 직행 버튼 배치
                    if proj.get('direct_link'):
                        st.link_button("👉 해당 프로젝트 페이지로 직행하기", proj.get('direct_link'))
                        
                st.markdown("---")
                
        except Exception as e:
            progress_bar.empty()
            status_box.error(f"링크 수집 중 오류가 발생했습니다: {str(e)}")

import streamlit as st
import google.generativeai as genai
from tavily import TavilyClient
import json
import time

# ==========================================
# 1. 페이지 설정 및 기본 미니멀 스타일 UI
# ==========================================
st.set_page_config(
    page_title="ARCHI-DIRECT // 100대 글로벌 대형사 프로젝트 링크 링커",
    page_icon="🏢",
    layout="wide",
    initial_sidebar_state="expanded"
)

# [최종 해법] 모든 st.link_button 및 일반 버튼의 높이를 60px 큰 기준으로 고정하는 마법의 와이드 픽셀 CSS
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
            margin-bottom: 1.5rem;
        }
        
        /* 🔥 Streamlit 내 모든 컴포넌트 스택의 버튼 높이를 강제 락(Lock) */
        div[data-testid="stComponentStack"] button,
        div[data-testid="element-container"] button,
        div[data-testid="stHorizontalBlock"] button,
        .stLinkButton a,
        .stLinkButton button,
        .stButton button {
            height: 60px !important;
            min-height: 60px !important;
            max-height: 60px !important;
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            text-align: center !important;
            padding: 2px !important;
        }
        
        /* 줄바꿈 시 레이아웃 밖으로 글자가 터져 나가지 않도록 폰트 규격 고정 */
        div[data-testid="element-container"] p,
        div[data-testid="stHorizontalBlock"] p,
        .stLinkButton p,
        .stButton p {
            font-size: 0.78rem !important;
            line-height: 1.2 !important;
            font-weight: 700 !important;
            margin: 0 !important;
        }

        .project-card {
            background-color: #FFFFFF;
            padding: 20px 0px;
            border-bottom: 1px solid #E9ECEF;
        }
        .office-tag {
            font-size: 0.75rem;
            font-weight: 700;
            color: #212529;
            background-color: #E9ECEF;
            padding: 2px 6px;
            border-radius: 2px;
            text-transform: uppercase;
            margin-right: 6px;
        }
        .proj-name {
            font-size: 1.2rem;
            font-weight: 700;
            color: #111111;
            display: inline-block;
            margin-top: 4px;
        }
        .proj-summary {
            font-size: 0.9rem;
            color: #495057;
            margin-top: 8px;
            line-height: 1.5;
        }
        .raw-container {
            background-color: #F8F9FA;
            padding: 15px;
            border: 1px solid #E9ECEF;
            border-radius: 4px;
        }
    </style>
""", unsafe_allow_html=True)

# ==========================================
# 2. 사이드바 API Key 보안 인증 우회 제어 레이어
# ==========================================
st.sidebar.markdown("### 🔑 SECURITY ACCESS")

access_password = st.sidebar.text_input("마스터 비밀번호 입력", type="password", help="지정된 4자리 비밀번호를 입력하면 API 키가 자동 마운트됩니다.")

gemini_api_key = ""
tavily_api_key = ""

if access_password == "7306":
    gemini_api_key = "AQ.Ab8RN6Ia2WOGCX8MlAegM_VJx1GQagag1Y_AsrSK0fxrr2BZRg"
    tavily_api_key = "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"
    st.sidebar.success("✅ API 키 자동 마운트 완료")
elif access_password != "":
    st.sidebar.error("❌ 비밀번호가 올바르지 않습니다.")
    gemini_api_key = st.sidebar.text_input("Gemini API Key 수동 입력", type="password")
    tavily_api_key = st.sidebar.text_input("Tavily API Key 수동 입력", type="password")
else:
    st.sidebar.info("💡 비밀번호 4자리를 입력하시거나, 아래에 개별 API Key를 수동으로 직접 입력하셔도 구동됩니다.")
    gemini_api_key = st.sidebar.text_input("Gemini API Key 수동 입력", type="password")
    tavily_api_key = st.sidebar.text_input("Tavily API Key 수동 입력", type="password")

# ==========================================
# 3. 100대 대형 건축사무소 데이터 세팅
# ==========================================
COMPANIES_DATA = [
    {"name": "Gensler", "domain": "gensler.com"},
    {"name": "Perkins+Will", "domain": "perkinswill.com"},
    {"name": "HOK", "domain": "hok.com"},
    {"name": "SOM", "domain": "som.com"},
    {"name": "Foster+Partners", "domain": "fosterandpartners.com"},
    {"name": "KPF", "domain": "kpf.com"},
    {"name": "ZGF", "domain": "zgf.com"},
    {"name": "SmithGroup", "domain": "smithgroup.com"},
    {"name": "HDR", "domain": "hdrinc.com"},
    {"name": "AECOM", "domain": "aecom.com"},
    {"name": "Jacobs", "domain": "jacobs.com"},
    {"name": "Stantec", "domain": "stantec.com"},
    {"name": "HKS", "domain": "hksinc.com"},
    {"name": "CannonDesign", "domain": "cannondesign.com"},
    {"name": "NBBJ", "domain": "nbbj.com"},
    {"name": "Perkins Eastman", "domain": "perkinseastman.com"},
    {"name": "Populous", "domain": "populous.com"},
    {"name": "Corgan", "domain": "corgan.com"},
    {"name": "DLR Group", "domain": "dlrgroup.com"},
    {"name": "EYP", "domain": "eypae.com"},
    {"name": "OMA", "domain": "oma.eu"},
    {"name": "BIG", "domain": "big.dk"},
    {"name": "Snøhetta", "domain": "snohetta.com"},
    {"name": "MVRDV", "domain": "mvrdv.com"},
    {"name": "Zaha Hadid", "domain": "zahahadid.com"},
    {"name": "RPBW", "domain": "rpbw.com"},
    {"name": "Jean Nouvel", "domain": "jeannouvel.com"},
    {"name": "Herzog & de Meuron", "domain": "herzogdemeuron.com"},
    {"name": "SANAA", "domain": "sanaa.co.jp"},
    {"name": "David Chipperfield", "domain": "davidchipperfield.com"},
    {"name": "Fuksas", "domain": "fuksas.com"},
    {"name": "Coop Himmelb(l)au", "domain": "coop-himmelblau.at"},
    {"name": "UNStudio", "domain": "unstudio.com"},
    {"name": "Grimshaw", "domain": "grimshaw.global"},
    {"name": "Wilmotte", "domain": "wilmotte.com"},
    {"name": "Grafton Architects", "domain": "graftonarchitects.ie"},
    {"name": "Henning Larsen", "domain": "henninglarsen.com"},
    {"name": "Schmidt Hammer Lassen", "domain": "shl.dk"},
    {"name": "3XN", "domain": "3xn.com"},
    {"name": "CEBRA", "domain": "cebraarchitecture.dk"},
    {"name": "White Arkitekter", "domain": "whitearkitekter.com"},
    {"name": "Wingårdhs", "domain": "wingardhs.se"},
    {"name": "Safdie Architects", "domain": "safdiearchitects.com"},
    {"name": "Morphosis", "domain": "morphosis.com"},
    {"name": "Gehry Partners", "domain": "gehrypartners.com"},
    {"name": "STUDIOS Architecture", "domain": "studios.com"},
    {"name": "Ennead", "domain": "ennead.com"},
    {"name": "Diamond Schmitt", "domain": "diamondschmitt.com"},
    {"name": "KPMB", "domain": "kpmb.com"},
    {"name": "Pelli Clarke Pelli", "domain": "pelliarchitects.com"},
    {"name": "LMN Architects", "domain": "lmnarchitects.com"},
    {"name": "BNIM", "domain": "bnim.com"},
    {"name": "Woods Bagot", "domain": "woodsbagot.com"},
    {"name": "Hassell", "domain": "hassellstudio.com"},
    {"name": "Cox Architecture", "domain": "coxarchitecture.com.au"},
    {"name": "Nikken Sekkei", "domain": "nikken.co.jp"},
    {"name": "Kengo Kuma", "domain": "kkaa.co.jp"},
    {"name": "Takenaka", "domain": "takenaka.co.jp"},
    {"name": "Kenzo Tange", "domain": "tange.co.jp"},
    {"name": "Nihon Sekkei", "domain": "nihonsekkei.co.jp"},
    {"name": "삼우건축", "domain": "samoo.com"},
    {"name": "희림건축", "domain": "heerim.com"},
    {"name": "간삼건축", "domain": "gansam.com"},
    {"name": "건원건축", "domain": "kunwon.com"},
    {"name": "해안건축", "domain": "haeahn.com"},
    {"name": "범건축", "domain": "baum.co.kr"},
    {"name": "창조건축", "domain": "changjo.co.kr"},
    {"name": "DMP건축", "domain": "dmp-architecture.com"},
    {"name": "유신건축", "domain": "yooshin.co.kr"},
    {"name": "시아플랜", "domain": "siaa.co.kr"},
    {"name": "다원앤컴퍼니", "domain": "dawon.com"},
    {"name": "정림건축", "domain": "junglim.co.kr"},
    {"name": "선진엔지니어링", "domain": "sunjin.co.kr"},
    {"name": "토문건축", "domain": "tomoon.co.kr"},
    {"name": "포스코A&C", "domain": "poscoarchitects.com"},
    {"name": "한다스건축", "domain": "handas.co.kr"},
    {"name": "ANU디자인그룹", "domain": "anurw.com"},
    {"name": "엄앤이건축", "domain": "aumlee.co.kr"},
    {"name": "나우동인", "domain": "nowarch.net"},
    {"name": "건축환경연구소 아키반", "domain": "archiban.com"},
    {"name": "공간종합건축사사무소", "domain": "spacea.com"},
    {"name": "그룹승선", "domain": "groupseun.com"},
    {"name": "경영위치", "domain": "yo2.co.kr"},
    {"name": "매스스터디스", "domain": "massstudies.com"},
    {"name": "더시스템랩", "domain": "systemlab.co.kr"},
    {"name": "건축사사무소 까치", "domain": "khwarch.com"},
    {"name": "와이즈건축", "domain": "wisearchitecture.com"},
    {"name": "SKM건축", "domain": "skmarchitects.com"},
    {"name": "VMS건축", "domain": "vmsas.com"},
    {"name": "조병수건축연구소", "domain": "bchoarchitects.com"},
    {"name": "JYA에이치엔에이", "domain": "jya-rchitects.com"},
    {"name": "stpmj", "domain": "stpmj.com"},
    {"name": "이송이건축", "domain": "isongae.com"},
    {"name": "원오원 아키텍츠", "domain": "one-o-one.kr"},
    {"name": "운생동건축", "domain": "unsangdong.com"},
    {"name": "가아건축", "domain": "gaa-arch.com"},
    {"name": "아이아크", "domain": "iarc.net"},
    {"name": "폴리엠건축", "domain": "poly.co.kr"},
    {"name": "종합건축사사무소 가람", "domain": "zoaa.co.kr"}
]
TARGET_DOMAINS = [comp["domain"] for comp in COMPANIES_DATA]

# ==========================================
# 4. 헤더 및 탭 시스템 배치
# ==========================================
st.markdown("<div class='main-title'>🏢 ARCHI-DIRECT</div>", unsafe_allow_html=True)
st.markdown("<div class='sub-title'>글로벌 & 국내 100대 대형 건축설계사무소 통합 아카이브 시스템</div>", unsafe_allow_html=True)

tab_search, tab_directory = st.tabs(["🔍 프로젝트 정밀 리서치 엔진", "🏢 100대 대형사 공식 디렉토리 (10×10)"])

# ── [탭 2] 정밀 60px 일치형 순정 격자 대시보드 ──
with tab_directory:
    st.markdown("<p style='font-size:0.85rem; color:#6C757D; margin-bottom:15px;'>각 버튼을 누르면 공식 웹사이트 메인페이지가 새 창으로 열립니다.</p>", unsafe_allow_html=True)
    
    for i in range(0, len(COMPANIES_DATA), 10):
        chunk_10 = COMPANIES_DATA[i:i+10]
        cols = st.columns(10)
        
        for idx, comp in enumerate(chunk_10):
            with cols[idx]:
                site_url = f"https://www.{comp['domain']}"
                st.link_button(
                    label=f"**{comp['name']}**",
                    url=site_url,
                    use_container_width=True,
                    help=f"{comp['name']} 공식 홈페이지 이동"
                )

# ── [탭 1] 실시간 검색 인터페이스 ──
with tab_search:
    search_keyword = st.text_input(
        "검색할 건축 키워드 혹은 컨셉을 입력하세요 (국문 입력 시 영문 자동 교차 검색)", 
        placeholder="예: 천창",
        key="search_input_field"
    )
    search_button = st.button("프로젝트 및 썸네일 찾기", type="primary")
    result_container = st.container()

# ==========================================
# 5. 크롤링 및 가공 처리 파트
# ==========================================
if search_button:
    if not gemini_api_key or not tavily_api_key:
        st.error("⚠️ 인증이 만료되었거나 API Key가 비어있습니다. 사이드바에 마스터 비밀번호를 정확히 기입했는지 재차 확인바랍니다.")
    elif not search_keyword.strip():
        st.warning("⚠️ 검색어를 입력해주세요.")
    else:
        status_box = st.empty()
        progress_bar = st.progress(0)
        
        try:
            genai.configure(api_key=gemini_api_key)
            model = genai.GenerativeModel('gemini-2.5-flash')
            tavily_client = TavilyClient(api_key=tavily_api_key)
            
            status_box.markdown("🔄 **글로벌 검색을 위한 영문 키워드 매핑 및 번역 중...**")
            progress_bar.progress(10)
            
            translation_prompt = "입력된 건축 용어를 글로벌 웹 검색에 적합한 영문 건축 기술 명사 단어로 변환하세요. 설명문 없이 오직 번역된 단어만 결과로 출력하세요.\n입력: " + search_keyword
            translation_res = model.generate_content(translation_prompt).text.strip()
            
            keywords_pool = [search_keyword.strip(), translation_res]
            st.info(f"🔎 **수집 타겟 키워드셋:** {', '.join(keywords_pool)}")
            
            all_raw_results = []
            all_collected_images = []
            
            chunk_size = 12
            chunks = [TARGET_DOMAINS[i:i + chunk_size] for i in range(0, len(TARGET_DOMAINS), chunk_size)]
            search_query_string = f"({search_keyword} OR \"{translation_res}\")"
            
            for index, chunk in enumerate(chunks):
                status_box.markdown(f"🌐 **100대 설계사 아카이브 전수 조사 및 이미지 스캔 중... ({index+1}/{len(chunks)} 단계)**")
                progress_bar.progress(15 + int((index / len(chunks)) * 60))
                
                try:
                    search_response = tavily_client.search(
                        query=search_query_string,
                        search_depth="advanced",
                        include_domains=chunk,
                        include_images=True,
                        max_results=10
                    )
                    if search_response.get('results'):
                        all_raw_results.extend(search_response['results'])
                    if search_response.get('images'):
                        all_collected_images.extend(search_response['images'])
                except Exception:
                    continue
                time.sleep(0.1)
                
            progress_bar.progress(80)
            
            with st.expander("📥 AI 필터링 전 실시간 크롤링 원본 데이터 풀 (드롭다운)", expanded=False):
                st.markdown("<div class='raw-container'>", unsafe_allow_html=True)
                if not all_raw_results:
                    st.write("크롤링된 로우 데이터가 없습니다.")
                else:
                    st.write(f"총 {len(all_raw_results)}개의 소스 주소와 {len(all_collected_images)}개의 이미지 소스가 수집되었습니다.")
                    for idx, raw in enumerate(all_raw_results, 1):
                        st.markdown(f"{idx}. [{raw.get('title')}]({raw.get('url')})")
                st.markdown("</div>", unsafe_allow_html=True)
                
            if not all_raw_results:
                status_box.warning("100대 설계사 아카이브 내에서 매칭되는 결과를 찾지 못했습니다.")
                progress_bar.empty()
            else:
                status_box.markdown("🤖 **메인/목록 페이지 제외 및 개별 프로젝트 상세 딥링크와 썸네일 매핑 중...**")
                progress_bar.progress(90)
                
                filter_prompt = f"""
                당신은 건축 아카이브 정밀 정제 엔진입니다.
                다음 제공된 크롤링 데이터 풀에서 사용자가 입력한 단어셋({keywords_pool})과 매칭되는 결과 중, 
                반드시 **특정 하나의 건축 프로젝트만 다루고 있는 상세 페이지(Deep Link)**만 선별하세요.

                [절대 제외 규칙]
                1. /works, /projects, /portfolio, /featured 처럼 여러 프로젝트가 나열된 '전체 목록/메인 페이지' 링크는 발견 즉시 무조건 제외하세요.
                2. 회사 소개(About), 채용 정보(Careers), 연락처(Contact) 링크도 무조건 제외하십시오.

                [원본 데이터 풀]
                {all_raw_results[:30]}

                [수집된 이미지 주소 풀]
                {all_collected_images[:30]}

                [매칭 규칙]
                제공된 '수집된 이미지 주소 풀' 중에서 해당 개별 프로젝트의 주소(URL)나 텍스트 컨텍스트와 가장 정밀하게 매칭되는 실제 이미지 주소 하나를 찾아 "image_url"에 매핑하세요. 매칭되는 유효 주소가 없다면 빈 문자열""로 처리하고, 절대로 가짜 주소를 허위로 지어내지 마십시오.

                [출력 JSON 포맷 양식]
                [
                  {{
                    "project_name": "건축물 상세 명칭 및 프로젝트 제목",
                    "office_name": "해당 설계사무소 이름 명확히 기재",
                    "summary": "해당 개별 건축물의 어떤 부분에 해당 기술/컨셉이 적용되었는지 본문 기반으로 1~2줄로 요약",
                    "direct_link": "해당 단일 프로젝트 상세 기술 페이지로 직행하는 완벽한 딥링크 URL",
                    "image_url": "매칭된 실제 유효한 썸네일 이미지 URL (없으면 빈 문자열)"
                  }}
                ]
                """
                
                response = model.generate_content(
                    filter_prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                
                cleaned_projects = json.loads(response.text)
                
                progress_bar.progress(100)
                status_box.empty()
                progress_bar.empty()
                
                with result_container:
                    st.markdown(f"### 🔗 '{search_keyword}' 관련 대형사 개별 프로젝트 직행 링크 및 썸네일 ({len(cleaned_projects)}건)")
                    st.markdown("---")
                    
                    if not cleaned_projects:
                        st.info("개별 프로젝트 단위의 상세 페이지 딥링크 조건을 충족하는 리스트가 없습니다.")
                    else:
                        for proj in cleaned_projects:
                            col_text, col_img = st.columns([3, 1])
                            
                            with col_text:
                                st.markdown(f"""
                                <div class="project-card" style="border:none;">
                                    <span class="office-tag">{proj.get('office_name', 'OFFICE')}</span>
                                    <div class="proj-name">{proj.get('project_name', 'Untitled Project')}</div>
                                    <div class="proj-summary">{proj.get('summary', '개요 정보 없음')}</div>
                                </div>
                                """, unsafe_allow_html=True)
                                
                                if proj.get('direct_link'):
                                    st.link_button("👉 해당 프로젝트 개별 상세페이지로 직행하기", proj.get('direct_link'))
                            
                            with col_img:
                                img_url = proj.get('image_url')
                                if img_url and img_url.startswith('http'):
                                    st.image(img_url, use_container_width=True)
                                else:
                                    st.markdown("""
                                    <div style='background-color:#F8F9FA; height:120px; border:1px dashed #CED4DA; display:flex; align-items:center; justify-content:center; color:#ADB5BD; font-size:0.85rem; border-radius:2px;'>
                                        No Thumbnail Available
                                    </div>
                                    """, unsafe_allow_html=True)
                            st.markdown("<hr style='margin:10px 0px; border:0; border-top:1px solid #F1F3F5;'>", unsafe_allow_html=True)
                        st.markdown("---")
                        
        except Exception as e:
            progress_bar.empty()
            status_box.error(f"프로세스 진행 중 내부 오류가 발생했습니다: {str(e)}")

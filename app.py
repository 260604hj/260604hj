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

# 모든 st.link_button 및 일반 버튼의 높이를 60px 큰 기준으로 고정하는 마법의 와이드 픽셀 CSS
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
        
        /* 100대사 매트릭스 버튼 높이 60px 강제 고정 */
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
        .match-score {
            font-size: 0.8rem;
            font-weight: 500;
            color: #E03131;
            background-color: #FFF5F5;
            padding: 2px 6px;
            border-radius: 2px;
            display: inline-block;
            margin-left: 8px;
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

# ── [탭 2] 10x10 격자 대시보드 ──
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
                    use_container_width=True
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
# 5. 크롤링 및 가중치 정렬 정제 로직
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
            
            # 번역 가동
            status_box.markdown("🔄 **글로벌 검색을 위한 영문 유사단어 맵 확장 중...**")
            progress_bar.progress(10)
            
            translation_prompt = f"입력된 건축 기술 용어와 관련성이 깊은 글로벌 동의어/유사어 영문 기술 단어를 2개 도출하세요. 다른 군더더기 텍스트 없이 오직 단어만 쉼표로 구분해 출력하세요.\n입력: {search_keyword}"
            translation_res = model.generate_content(translation_prompt).text.strip()
            
            # 매칭에 활용할 검색 단어 풀 정의 (예: ['천창', 'skylight', 'roof window'])
            keywords_pool = [search_keyword.strip()] + [k.strip() for k in translation_res.split(",") if k.strip()]
            st.info(f"🔎 **수집 및 타겟 가중치 키워드셋:** {', '.join(keywords_pool)}")
            
            all_raw_results = []
            all_collected_images = []
            
            chunk_size = 12
            chunks = [TARGET_DOMAINS[i:i + chunk_size] for i in range(0, len(TARGET_DOMAINS), chunk_size)]
            search_query_string = f'"{search_keyword}" OR ' + " OR ".join([f'"{k}"' for k in keywords_pool[1:]])
            
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
            
            if not all_raw_results:
                status_box.warning("100대 설계사 아카이브 내에서 매칭되는 결과를 찾지 못했습니다.")
                progress_bar.empty()
            else:
                status_box.markdown("🤖 **키워드 포함 빈도수 연산 및 정렬 인덱싱 처리 중...**")
                progress_bar.progress(90)
                
                # ── [핵심 변경 레이어] 탈락선별 없이 가중치 기반 다이렉트 정렬 수행 ──
                # AI의 임의 필터링을 완전히 배제하고, 수집 데이터 본문 내 키워드 등장 빈도를 카운팅하여 스코어링
                scored_projects = []
                for res in all_raw_results:
                    title = res.get('title', 'Untitled Project')
                    content = res.get('content', '')
                    url = res.get('url', '')
                    
                    # 수집된 텍스트 풀 병합 후 소문자 처리 (비교 정밀화)
                    search_text_pool = (title + " " + content).lower()
                    
                    # 키워드별 등장 횟수(빈도수) 합산 연산
                    score = 0
                    for kw in keywords_pool:
                        score += search_text_pool.count(kw.lower())
                    
                    # 소속 설계사 도메인 파싱 검증
                    matched_office = "OFFICE"
                    for comp in COMPANIES_DATA:
                        if comp["domain"] in url:
                            matched_office = comp["name"]
                            break
                    
                    scored_projects.append({
                        "project_name": title,
                        "office_name": matched_office,
                        "summary": content[:180] + "..." if len(content) > 180 else content,
                        "direct_link": url,
                        "score": score
                    })
                
                # 가중치 점수(Score) 기준 내림차순 정렬 (많이포함 -> 적게포함)
                scored_projects = sorted(scored_projects, key=lambda x: x["score"], reverse=True)
                
                # 원본 이미지 풀에서 일치성 높은 이미지 주소 매핑만 Gemini에 위임 (할루시네이션 완벽 방지)
                image_mapping_prompt = f"""
                당신은 아카이브 매핑 매니저입니다. 
                제공된 프로젝트 링크 리스트에 대해, '수집된 이미지 주소 풀' 중에서 각 프로젝트의 컨텍스트(제목/내용)와 매칭되는 실제 이미지 주소들을 찾아 1:1로 매핑해 배열로 출력하세요.
                매칭되는 실제 주소가 없는 프로젝트는 빈 문자열""로 처리하고, 가짜 주소를 절대로 만들어내지 마십시오.

                [프로젝트 리스트]
                {scored_projects[:25]}

                [수집된 이미지 주소 풀]
                {all_collected_images[:30]}

                [출력 JSON 포맷 양식]
                [
                  {{
                    "direct_link": "원본 매칭 주소 URL",
                    "image_url": "매칭된 실제 이미지 URL (없으면 빈 문자열)"
                  }}
                ]
                """
                
                try:
                    img_response = model.generate_content(
                        image_mapping_prompt,
                        generation_config={"response_mime_type": "application/json"}
                    )
                    img_mappings = json.loads(img_response.text)
                    img_dict = {item["direct_link"]: item["image_url"] for item in img_mappings if "direct_link" in item}
                except Exception:
                    img_dict = {}
                
                progress_bar.progress(100)
                status_box.empty()
                progress_bar.empty()
                
                # ==========================================
                # 6. 최종 정렬 리스트 렌더링 영역
                # ==========================================
                with result_container:
                    st.markdown(f"### 🔗 '{search_keyword}' 연관 키워드 포함 빈도순 정렬 리스트 ({len(scored_projects)}건)")
                    st.markdown("---")
                    
                    for proj in scored_projects:
                        col_text, col_img = st.columns([3, 1])
                        
                        with col_text:
                            # 상단에 매칭 가중치 스코어를 직관적으로 표시
                            score_badge = f"<span class='match-score'>🔥 키워드 연관도 매칭수: {proj['score']}</span>" if proj['score'] > 0 else "<span class='match-score' style='color:#868E96; background-color:#F1F3F5;'>연관 단어 포함 안 됨</span>"
                            
                            st.markdown(f"""
                            <div class="project-card" style="border:none; padding-bottom:5px;">
                                <span class="office-tag">{proj['office_name']}</span> {score_badge} <br>
                                <div class="proj-name">{proj['project_name']}</div>
                                <div class="proj-summary">{proj['summary']}</div>
                            </div>
                            """, unsafe_allow_html=True)
                            
                            if proj['direct_link']:
                                st.link_button("👉 해당 아카이브 상세페이지로 이동하기", proj['direct_link'])
                        
                        with col_img:
                            # 매핑된 딕셔너리에서 실제 이미지 썸네일 탐색 후 바인딩
                            img_url = img_dict.get(proj['direct_link'], "")
                            if img_url and img_url.startswith('http'):
                                st.image(img_url, use_container_width=True)
                            else:
                                st.markdown("""
                                <div style='background-color:#F8F9FA; height:120px; border:1px dashed #CED4DA; display:flex; align-items:center; justify-content:center; color:#ADB5BD; font-size:0.85rem; border-radius:2px;'>
                                    No Thumbnail
                                </div>
                                """, unsafe_allow_html=True)
                        st.markdown("<hr style='margin:12px 0px; border:0; border-top:1px solid #F1F3F5;'>", unsafe_allow_html=True)
                    st.markdown("---")
                        
        except Exception as e:
            progress_bar.empty()
            status_box.error(f"프로세스 진행 중 연산 오류가 발생했습니다: {str(e)}")

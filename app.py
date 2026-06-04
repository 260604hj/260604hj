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
gemini_api_key = st.sidebar.text_input("Gemini API Key", type="password")
tavily_api_key = st.sidebar.text_input("Tavily API Key", type="password")

st.sidebar.markdown("---")
st.sidebar.markdown("""
<div style='font-size: 0.8rem; color: #868E96; line-height: 1.5;'>
<strong>ARCHI-DIRECT v2.2</strong><br>
- 쿼리 스트링 400자 제한 원천 차단 패치 적용<br>
- Tavily Native Domain Filter 옵션 전면 개편
</div>
""", unsafe_allow_html=True)

# ==========================================
# 3. 메인 UI 및 검색어 입력
# ==========================================
st.markdown("<div class='main-title'>🏢 ARCHI-DIRECT</div>", unsafe_allow_html=True)
st.markdown("<div class='sub-title'>글로벌 & 국내 100대 대형 건축설계사무소 프로젝트 페이지 다이렉트 링크 매퍼</div>", unsafe_allow_html=True)

search_keyword = st.text_input(
    "검색할 건축 키워드 혹은 컨셉을 입력하세요", 
    placeholder="예: 천창"
)

search_button = st.button("프로젝트 페이지 링크 찾기", type="primary")

# ==========================================
# 4. 100대 대형 건축사무소 도메인 리스트
# ==========================================
TARGET_DOMAINS = [
    "gensler.com", "perkinswill.com", "hok.com", "som.com", "fosterandpartners.com",
    "kpf.com", "zgf.com", "smithgroup.com", "hdrinc.com", "aecom.com",
    "jacobs.com", "stantec.com", "hksinc.com", "cannondesign.com", "nobbli.com",
    "perkinseastman.com", "populous.com", "corgan.com", "dlrgroup.com", "eypae.com",
    "oma.eu", "big.dk", "snohetta.com", "mvrdv.com", "zahahadid.com",
    "rpbw.com", "jeannouvel.com", "herzogdemeuron.com", "sanaa.co.jp", "davidchipperfield.com",
    "fuksas.com", "coop-himmelblau.at", "unstudio.com", "mvrdv.nl", "bjarkeingelsgroup.com",
    "grimshaw.global", "wilmotte.com", "graftonarchitects.ie", "henninglarsen.com", "shl.dk",
    "schmidthammerlassen.com", "3xn.com", "cebraarchitecture.dk", "whitearkitekter.com", "wingardhs.se",
    "safdiearchitects.com", "morphosis.com", "gehrypartners.com", "studios.com", "ennead.com",
    "diamondschmitt.com", "kpmb.com", "pelliarchitects.com", "lmnarchitects.com", "bnim.com",
    "woodsbagot.com", "hassellstudio.com", "coxarchitecture.com.au", "nikken.co.jp", "kkaa.co.jp",
    "takenaka.co.jp", "tange.co.jp", "nihonsekkei.co.jp", "samoo.com", "heerim.com",
    "gansam.com", "kunwon.com", "haeahn.com", "baum.co.kr", "changjo.co.kr",
    "dmp-architecture.com", "yooshin.co.kr", "siaa.co.kr", "dawon.com", "junglim.co.kr",
    "sunjin.co.kr", "tomoon.co.kr", "poscoarchitects.com", "handas.co.kr", "anurw.com",
    "aumlee.co.kr", "nowarch.net", "archiban.com", "spacea.com", "groupseun.com",
    "yo2.co.kr", "massstudies.com", "systemlab.co.kr", "khwarch.com", "wisearchitecture.com",
    "skmarchitects.com", "vmsas.com", "bchoarchitects.com", "jya-rchitects.com", "stpmj.com",
    "isongae.com", "one-o-one.kr", "unsangdong.com", "gaa-arch.com", "iarc.net"
]

# ==========================================
# 5. 실행 로직 (Native Domain Filter 활용)
# ==========================================
if search_button:
    if not gemini_api_key or not tavily_api_key:
        st.error("⚠️ 사이드바에 양쪽 API Key를 모두 입력해주세요.")
    elif not search_keyword.strip():
        st.warning("⚠️ 검색어를 입력해주세요.")
    else:
        status_box = st.empty()
        progress_bar = st.progress(0)
        
        try:
            tavily_client = TavilyClient(api_key=tavily_api_key)
            all_raw_results = []
            
            # API 제한에 걸리지 않도록 도메인 필터를 청크(초과 에러 방지용) 분할하여 수집
            chunk_size = 20
            chunks = [TARGET_DOMAINS[i:i + chunk_size] for i in range(0, len(TARGET_DOMAINS), chunk_size)]
            
            # 쿼리는 철저하게 핵심 키워드 하나만 둠 (무조건 10글자 내외로 유지되어 에러 없음)
            safe_pure_query = f'"{search_keyword.strip()}"'
            
            for index, chunk in enumerate(chunks):
                status_box.markdown(f"🌐 **100대 설계사 통합 탐색 중... ({index+1}/{len(chunks)} 단계 완료)**")
                progress_bar.progress(int((index / len(chunks)) * 75))
                
                try:
                    # site: 연산자 대신 Tavily 자체 제공 include_domains 매개변수 사용 (★핵심 변경점)
                    search_response = tavily_client.search(
                        query=safe_pure_query,
                        search_depth="advanced",
                        include_domains=chunk,
                        max_results=5
                    )
                    if search_response.get('results'):
                        all_raw_results.extend(search_response['results'])
                except Exception:
                    continue
                
                time.sleep(0.1)
                
            progress_bar.progress(80)
            
            if not all_raw_results:
                status_box.warning("입력하신 키워드와 직접 매칭되는 대형사 프로젝트 아카이브를 찾지 못했습니다.")
                progress_bar.empty()
            else:
                status_box.markdown("🤖 **불필요한 링크 제외 및 직행 주소 정렬 중...**")
                progress_bar.progress(90)
                
                genai.configure(api_key=gemini_api_key)
                model = genai.GenerativeModel('gemini-2.5-flash')
                
                prompt = f"""
                당신은 건축 데이터 정제 도구입니다.
                다음 검색 결과 원본에서 사용자가 입력한 키워드('{search_keyword}')와 긴밀하게 연관된 실제 '건축 설계 프로젝트 상세 페이지 혹은 리스트 아카이브 페이지'만 엄선해 JSON 배열로 정리하세요.
                본문 내에 해당 키워드가 직접 포함되어 있는 유효 결과만 취급하고, 임의로 단어 뜻을 확장하거나 허위 주소를 지어내지 마십시오.

                [원본 데이터]
                {all_raw_results[:20]}

                [출력 JSON 포맷 양식]
                [
                  {{
                    "project_name": "건축물 이름 혹은 프로젝트 제목 (모르면 해당 페이지 타이틀 활용)",
                    "office_name": "설계사무소 이름 (예: Foster + Partners, 삼우건축, OMA 등)",
                    "summary": "해당 프로젝트에 사용자의 키워드가 어떻게 포함되어 있는지 본문을 기반으로 1줄 요약",
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
                    st.markdown(f"""
                    <div class="project-item">
                        <span class="office-tag">{proj.get('office_name', 'OFFICE')}</span>
                        <div class="proj-name">{proj.get('project_name', 'Untitled Project')}</div>
                        <div class="proj-summary">{proj.get('summary', '개요 정보 없음')}</div>
                    </div>
                    """, unsafe_allow_html=True)
                    
                    if proj.get('direct_link'):
                        st.link_button("👉 해당 프로젝트 페이지로 직행하기", proj.get('direct_link'))
                        
                st.markdown("---")
                
        except Exception as e:
            progress_bar.empty()
            status_box.error(f"링크 수집 중 오류가 발생했습니다: {str(e)}")

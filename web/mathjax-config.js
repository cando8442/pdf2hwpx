// MathJax 설정. 인라인 <script> 로 두면 CSP 에 'unsafe-inline' 을 열어야 하므로
// 별도 파일로 뺐다. tex-mml-chtml.min.js 보다 먼저 로드되어야 한다.
window.MathJax = {
  tex: { inlineMath: [['\\(', '\\)']] },
  startup: { typeset: false },
  options: { enableMenu: false },
};

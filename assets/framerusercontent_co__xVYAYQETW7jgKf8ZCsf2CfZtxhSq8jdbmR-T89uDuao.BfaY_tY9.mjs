import{t as e}from"./framerusercontent_co__rolldown-runtime.Bi-D_2cA.mjs";async function t(e,t,i){let a=r[e],o=a?await a(t,i):void 0,s={bodyEnd:[],bodyStart:[],headEnd:[],headStart:[]};for(let t of n){if(t.pageIds&&!t.pageIds.has(e))continue;let n=t.code(o,i);n&&s[t.placement].push({...t,code:n})}return s}var n,r,i,a;function o(){return(o=e((()=>{n=[{code:(e,t)=>`<script>
(function () {
  // Collect utm_* params from the current page URL
  var pageParams = new URLSearchParams(window.location.search);
  var utmEntries = [];
  pageParams.forEach(function(value, key) {
    if (/^utm_/i.test(key)) utmEntries.push([key, value]);
  });

  if (utmEntries.length === 0) return; // Nothing to do

  // Helper: is absolute URL (with a scheme)
  function isAbsolute(href) {
    return /^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(href);
  }

  // Helper: skip schemes we shouldn't touch
  function isSkippableScheme(href) {
    return /^(mailto:|tel:|javascript:|data:|blob:)/i.test(href);
  }

  // For each link, add missing UTM params
  document.querySelectorAll('a[href]').forEach(function(a) {
    var originalHref = a.getAttribute('href');
    if (!originalHref || isSkippableScheme(originalHref)) return;

    // Construct a URL object relative to the document for robust param editing
    var url;
    try {
      url = new URL(originalHref, document.baseURI);
    } catch (e) {
      // If the href is malformed, skip it gracefully
      return;
    }

    // Add UTM params if not already present on the link
    utmEntries.forEach(function([key, value]) {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    });

    // Preserve relative-ness if the original href was relative
    if (!isAbsolute(originalHref)) {
      // Rebuild relative path + query + hash
      var relative =
        url.pathname +
        (url.search ? url.search : "") +
        (url.hash ? url.hash : "");
      a.setAttribute('href', relative);
    } else {
      a.setAttribute('href', url.toString());
    }
  });
})();
<\/script>
`,id:`legacy-bodyEnd-Yl8xcI_Ds`,loadMode:`once`,name:`Utm params`,pageIds:/* @__PURE__ */ new Set([`Yl8xcI_Ds`]),placement:`bodyEnd`}],r={},i={bodyEnd:[`legacy-bodyEnd-Yl8xcI_Ds`,`legacy-bodyEnd-abNSYDyGS`,`AXORz3VmN`,`pyZNndFPJ`],bodyStart:[],headEnd:[],headStart:[`legacy-headStart`,`xYo3Pk4B4`]},a={exports:{getSnippets:{type:`function`,isAsync:!0,annotations:{framerContractVersion:`1`}},snippetsSorting:{type:`variable`,annotations:{framerContractVersion:`1`}},__FramerMetadata__:{type:`variable`}}}})))()}o();export{a as __FramerMetadata__,t as getSnippets,i as snippetsSorting};
//# sourceMappingURL=xVYAYQETW7jgKf8ZCsf2CfZtxhSq8jdbmR-T89uDuao.BfaY_tY9.mjs.map
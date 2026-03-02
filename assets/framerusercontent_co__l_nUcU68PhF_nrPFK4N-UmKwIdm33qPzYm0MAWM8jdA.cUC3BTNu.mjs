import{t as e}from"./framerusercontent_co__rolldown-runtime.CXBuSdYp.mjs";async function t(e,t,i){let a=r[e],o=a?await a(t,i):void 0,s={bodyEnd:[],bodyStart:[],headEnd:[],headStart:[]};for(let t of n){if(t.pageIds&&!t.pageIds.has(e))continue;let n=t.code(o);n&&s[t.placement].push({...t,code:n})}return s}var n,r,i,a;e((()=>{n=[{code:e=>`<script>
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
`,id:`legacy-bodyEnd-Yl8xcI_Ds`,loadMode:`once`,name:`Utm params`,pageIds:new Set([`Yl8xcI_Ds`]),placement:`bodyEnd`},{code:e=>`<script>
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

  document.querySelectorAll('a[href]').forEach(function(a) {
    var originalHref = a.getAttribute('href');
    if (!originalHref || isSkippableScheme(originalHref)) return;

    var url;
    try {
      url = new URL(originalHref, document.baseURI);
    } catch (e) {
      return; // malformed href, skip
    }

    // Ensure uniqueness: only add if missing
    utmEntries.forEach(function([key, value]) {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    });

    // Deduplicate just in case (remove duplicate keys if any)
    var seen = new Set();
    var deduped = new URLSearchParams();
    url.searchParams.forEach(function(value, key) {
      if (!seen.has(key)) {
        deduped.set(key, value);
        seen.add(key);
      }
    });
    url.search = deduped.toString();

    // Keep relative if original was relative
    if (!isAbsolute(originalHref)) {
      var relative =
        url.pathname +
        (url.search ? "?" + url.searchParams.toString() : "") +
        (url.hash ? url.hash : "");
      a.setAttribute('href', relative);
    } else {
      a.setAttribute('href', url.toString());
    }
  });
})();
<\/script>
`,id:`legacy-bodyEnd-abNSYDyGS`,loadMode:`once`,name:`Custom Code`,pageIds:new Set([`abNSYDyGS`]),placement:`bodyEnd`}],r={},i={bodyEnd:[`legacy-bodyEnd-Yl8xcI_Ds`,`legacy-bodyEnd-abNSYDyGS`,`AXORz3VmN`],bodyStart:[],headEnd:[],headStart:[`legacy-headStart`]},a={exports:{snippetsSorting:{type:`variable`,annotations:{framerContractVersion:`1`}},getSnippets:{type:`function`,annotations:{framerContractVersion:`1`}},__FramerMetadata__:{type:`variable`}}}}))();export{a as __FramerMetadata__,t as getSnippets,i as snippetsSorting};
//# sourceMappingURL=l_nUcU68PhF_nrPFK4N-UmKwIdm33qPzYm0MAWM8jdA.cUC3BTNu.mjs.map
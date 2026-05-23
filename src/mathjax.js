window.MathJax = {
  loader: { load: [] },
  options: {
    ignoreHtmlClass: 'disable-tex-rendering',
  },
  tex: {
    inlineMath: [
      ['$', '$'],
      ['\\(', '\\)'],
    ],
  },
  chtml: {
    fontURL: '/node_modules/mathjax/es5/output/chtml/fonts/woff-v2',
    scale: 1,
    minScale: 0.5,
    matchFontHeight: true,
    mtextInheritFont: false,
    merrorInheritFont: true,
    mathmlSpacing: false,
    skipAttributes: {},
    exFactor: 0.5,
    displayAlign: 'left',
    displayIndent: '0',
  },
  startup: {
    typeset: false,
    ready() {
      window.MathJax.startup.defaultReady()
      const { safe } = window.MathJax.startup.document
      if (safe) {
        safe.filterAttributes.set('fontfamily', 'filterFamily')
        safe.filterMethods.filterFamily = (_safe, family) => family.split(/;/)[0]
      }
      window.dispatchEvent(new Event('mathjax-ready'))
    },
  },
}

await import('mathjax/es5/tex-chtml-full.js')

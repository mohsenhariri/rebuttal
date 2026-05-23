import DOMPurify from 'dompurify'
import { marked } from 'marked'

function escapeHtml(value) {
  const template = document.createElement('template')
  template.textContent = value
  return template.innerHTML
}

const renderer = new marked.Renderer()

renderer.image = ({ href, title, text }) => {
  if (href?.startsWith('/images/')) {
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
    const classAttr = href.endsWith('_icon.svg') ? ' class="icon"' : ''
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text)}"${titleAttr}${classAttr}/>`
  }

  return escapeHtml(`<img src="${href}" alt="${text}" title="${title}">`)
}

renderer.checkbox = (token) => {
  const checked = typeof token === 'boolean' ? token : token?.checked
  return checked ? '[x]' : '[ ]'
}

renderer.html = (token) => {
  const html = typeof token === 'string' ? token : token?.text || token?.raw || ''
  return escapeHtml(html)
}

marked.setOptions({
  baseUrl: null,
  breaks: false,
  gfm: true,
  headerIds: false,
  langPrefix: 'language-',
  mangle: false,
  renderer,
})

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function renderOpenReviewMarkdown(value) {
  if (!value?.trim()) return '<em>Nothing to preview</em>'
  return DOMPurify.sanitize(marked(value))
}

export function hasLikelyUnescapedTexLineBreak(value) {
  return /\$[\s\S]*\\\\[\s\S]*\$/.test(value ?? '')
}

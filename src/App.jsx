import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  FileText,
  RotateCcw,
  Save,
  Share2,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react'
import { hasLikelyUnescapedTexLineBreak, renderOpenReviewMarkdown } from './openreviewMarkdown.js'

const DRAFT_KEY = 'oply-rebuttal-draft-v1'
const CHECKPOINTS_KEY = 'oply-rebuttal-checkpoints-v1'
const SHARE_HASH_PARAM = 'checkpoint'
const MAX_COMMENT_LENGTH = 5000
const MAX_IMPORTED_COMMENT_LENGTH = 20000
const MAX_CHECKPOINTS = 50
const MAX_CHECKPOINT_LABEL_LENGTH = 80

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const defaultDraft = {
  title: '',
  comment: '',
}

function normalizeDraft(draft) {
  return {
    title: typeof draft?.title === 'string' ? draft.title : '',
    comment: typeof draft?.comment === 'string' ? draft.comment : '',
  }
}

function loadDraft() {
  try {
    const savedDraft = localStorage.getItem(DRAFT_KEY)
    return savedDraft ? normalizeDraft(JSON.parse(savedDraft)) : defaultDraft
  } catch {
    return defaultDraft
  }
}

function loadCheckpoints() {
  try {
    const savedCheckpoints = localStorage.getItem(CHECKPOINTS_KEY)
    if (!savedCheckpoints) return []

    const parsedCheckpoints = JSON.parse(savedCheckpoints)
    if (!Array.isArray(parsedCheckpoints)) return []

    return parsedCheckpoints
      .filter((checkpoint) => checkpoint && typeof checkpoint === 'object')
      .map((checkpoint) => ({
        id: typeof checkpoint.id === 'string' ? checkpoint.id : createCheckpointId(),
        label: typeof checkpoint.label === 'string' ? checkpoint.label : 'Untitled checkpoint',
        createdAt:
          typeof checkpoint.createdAt === 'string' ? checkpoint.createdAt : new Date().toISOString(),
        ...normalizeDraft(checkpoint),
      }))
      .slice(0, MAX_CHECKPOINTS)
  } catch {
    return []
  }
}

function createCheckpointId() {
  return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const paddedBase64 = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(paddedBase64)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function encodeJson(value) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)))
}

function decodeJson(value) {
  return JSON.parse(textDecoder.decode(base64UrlToBytes(value)))
}

function canUseCheckpointSharing() {
  return Boolean(window.crypto?.subtle && window.crypto?.getRandomValues)
}

function getShareTokenFromHash() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (!hash) return ''

  return new URLSearchParams(hash).get(SHARE_HASH_PARAM) ?? ''
}

function removeShareTokenFromAddressBar() {
  const url = new URL(window.location.href)
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : ''
  const params = new URLSearchParams(hash)
  params.delete(SHARE_HASH_PARAM)

  const remainingHash = params.toString()
  const nextUrl = `${url.pathname}${url.search}${remainingHash ? `#${remainingHash}` : ''}`
  window.history.replaceState(null, '', nextUrl)
}

function validateSharedCheckpoint(payload) {
  if (!payload || payload.type !== 'oply-rebuttal-checkpoint' || payload.v !== 1) {
    throw new Error('Unsupported checkpoint link')
  }

  const label =
    typeof payload.label === 'string'
      ? payload.label.slice(0, MAX_CHECKPOINT_LABEL_LENGTH)
      : 'Shared checkpoint'
  const title = typeof payload.title === 'string' ? payload.title.slice(0, MAX_IMPORTED_COMMENT_LENGTH) : ''
  const comment = typeof payload.comment === 'string' ? payload.comment : ''
  const createdAt =
    typeof payload.createdAt === 'string' ? payload.createdAt : new Date().toISOString()

  if (comment.length > MAX_IMPORTED_COMMENT_LENGTH) {
    throw new Error('Checkpoint content is too large')
  }

  return {
    label: label.trim() || 'Shared checkpoint',
    title,
    comment,
    createdAt,
  }
}

async function createEncryptedCheckpointLink(checkpoint) {
  if (!canUseCheckpointSharing()) {
    throw new Error('Encrypted checkpoint links are not supported in this browser')
  }

  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const payload = {
    v: 1,
    type: 'oply-rebuttal-checkpoint',
    label: checkpoint.label,
    title: checkpoint.title,
    comment: checkpoint.comment,
    createdAt: checkpoint.createdAt,
    exportedAt: new Date().toISOString(),
  }
  const encryptedPayload = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(JSON.stringify(payload)),
  )
  const exportedKey = await window.crypto.subtle.exportKey('raw', key)
  const envelope = {
    v: 1,
    alg: 'A256GCM',
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(encryptedPayload)),
  }
  const token = `${encodeJson(envelope)}.${bytesToBase64Url(new Uint8Array(exportedKey))}`
  const url = new URL(window.location.href)
  url.hash = `${SHARE_HASH_PARAM}=${token}`

  return url.toString()
}

async function decryptSharedCheckpointToken(token) {
  if (!canUseCheckpointSharing()) {
    throw new Error('Encrypted checkpoint links are not supported in this browser')
  }

  const parts = token.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Invalid checkpoint link')
  }

  const envelope = decodeJson(parts[0])
  if (envelope?.v !== 1 || envelope?.alg !== 'A256GCM') {
    throw new Error('Unsupported checkpoint link')
  }

  const key = await window.crypto.subtle.importKey(
    'raw',
    base64UrlToBytes(parts[1]),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  )
  const decryptedPayload = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(envelope.iv) },
    key,
    base64UrlToBytes(envelope.data),
  )

  return validateSharedCheckpoint(JSON.parse(textDecoder.decode(decryptedPayload)))
}

function formatCheckpointDate(dateString) {
  const date = new Date(dateString)
  if (Number.isNaN(date.getTime())) return 'Unknown time'

  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function useMathJax(html, containerRef) {
  useEffect(() => {
    let cancelled = false
    let retryTimer = null
    let animationFrame = null

    const typeset = (attempt = 0) => {
      if (cancelled) return
      const container = containerRef.current
      if (!container) return

      if (!window.MathJax?.typesetPromise || !window.MathJax?.startup?.promise) {
        if (attempt < 60) {
          retryTimer = window.setTimeout(() => typeset(attempt + 1), 100)
        }
        return
      }

      window.MathJax.startup.promise
        .then(() => {
          if (cancelled || !containerRef.current) return null
          window.MathJax.typesetClear?.([containerRef.current])
          return window.MathJax.typesetPromise([containerRef.current])
        })
        .catch(() => {
          console.warn('Could not typeset TeX content')
        })
    }

    animationFrame = window.requestAnimationFrame(() => typeset())
    window.addEventListener('mathjax-ready', typeset)
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (animationFrame) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('mathjax-ready', typeset)
    }
  }, [html, containerRef])
}

const MarkdownPreview = memo(function MarkdownPreview({ html }) {
  const previewRef = useRef(null)
  useMathJax(html, previewRef)

  return (
    <div
      ref={previewRef}
      className="preview note-content-value markdown-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

function App() {
  const [draft, setDraft] = useState(loadDraft)
  const [checkpoints, setCheckpoints] = useState(loadCheckpoints)
  const [checkpointLabel, setCheckpointLabel] = useState('')
  const [activeCheckpointId, setActiveCheckpointId] = useState(null)
  const [selectedCheckpointId, setSelectedCheckpointId] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [actionStatus, setActionStatus] = useState('')
  const actionStatusTimerRef = useRef(null)
  const shareImportAttemptedRef = useRef(false)

  const commentLength = draft.comment.trim().length
  const remainingCharacters = MAX_COMMENT_LENGTH - commentLength
  const isDraftEmpty = draft.title.trim().length === 0 && draft.comment.trim().length === 0
  const isCheckpointSharingSupported = canUseCheckpointSharing()
  const activeCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === activeCheckpointId),
    [activeCheckpointId, checkpoints],
  )
  const selectedCheckpoint = useMemo(
    () => checkpoints.find((checkpoint) => checkpoint.id === selectedCheckpointId),
    [checkpoints, selectedCheckpointId],
  )
  const previewHtml = useMemo(() => renderOpenReviewMarkdown(draft.comment), [draft.comment])

  const showActionStatus = (message) => {
    if (actionStatusTimerRef.current) {
      window.clearTimeout(actionStatusTimerRef.current)
    }

    setActionStatus(message)
    actionStatusTimerRef.current = window.setTimeout(() => setActionStatus(''), 1800)
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
        setLastSavedAt(new Date())
      } catch {
        showActionStatus('Could not save draft locally')
      }
    }, 300)

    return () => window.clearTimeout(timeout)
  }, [draft])

  useEffect(() => {
    try {
      localStorage.setItem(CHECKPOINTS_KEY, JSON.stringify(checkpoints))
    } catch {
      showActionStatus('Could not save checkpoints locally')
    }
  }, [checkpoints])

  useEffect(() => {
    if (checkpoints.length === 0) {
      setSelectedCheckpointId('')
      return
    }

    if (!checkpoints.some((checkpoint) => checkpoint.id === selectedCheckpointId)) {
      setSelectedCheckpointId(checkpoints[0].id)
    }
  }, [checkpoints, selectedCheckpointId])

  useEffect(() => {
    if (shareImportAttemptedRef.current) return
    shareImportAttemptedRef.current = true

    const token = getShareTokenFromHash()
    if (!token) return

    const importSharedCheckpoint = async () => {
      try {
        const sharedCheckpoint = await decryptSharedCheckpointToken(token)

        removeShareTokenFromAddressBar()

        const shouldImport = window.confirm(
          `Import shared checkpoint "${sharedCheckpoint.label}"? Your current autosaved draft will be replaced.`,
        )
        if (!shouldImport) return

        const checkpoint = {
          id: createCheckpointId(),
          ...sharedCheckpoint,
        }

        setCheckpoints((currentCheckpoints) =>
          [checkpoint, ...currentCheckpoints].slice(0, MAX_CHECKPOINTS),
        )
        setDraft({
          title: checkpoint.title,
          comment: checkpoint.comment,
        })
        setActiveCheckpointId(checkpoint.id)
        setSelectedCheckpointId(checkpoint.id)
        showActionStatus(`Imported checkpoint "${checkpoint.label}"`)
      } catch {
        removeShareTokenFromAddressBar()
        showActionStatus('Could not open encrypted checkpoint link')
      }
    }

    importSharedCheckpoint()
  }, [])

  useEffect(() => {
    return () => {
      if (actionStatusTimerRef.current) {
        window.clearTimeout(actionStatusTimerRef.current)
      }
    }
  }, [])

  const updateDraft = (fieldName, value) => {
    setActiveCheckpointId(null)
    setDraft((currentDraft) => ({ ...currentDraft, [fieldName]: value }))
  }

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(draft.comment)
    showActionStatus('Copied comment Markdown')
  }

  const copyPayload = async () => {
    const payload = {
      title: draft.title.trim() || undefined,
      comment: draft.comment.trim(),
    }
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    showActionStatus('Copied draft payload')
  }

  const copySelectedCheckpointShareLink = async () => {
    if (!selectedCheckpoint) return

    const shouldShare = window.confirm(
      `Create an encrypted link for checkpoint "${selectedCheckpoint.label}"? Anyone with the full link can read it.`,
    )
    if (!shouldShare) return

    try {
      const shareLink = await createEncryptedCheckpointLink(selectedCheckpoint)
      try {
        await navigator.clipboard.writeText(shareLink)
        showActionStatus('Copied encrypted checkpoint link')
      } catch {
        window.prompt('Copy encrypted checkpoint link:', shareLink)
        showActionStatus('Created encrypted checkpoint link')
      }
    } catch {
      showActionStatus('Could not create encrypted checkpoint link')
    }
  }

  const saveCheckpoint = (event) => {
    event.preventDefault()

    const label = checkpointLabel.trim()
    if (!label || isDraftEmpty) return

    const checkpoint = {
      id: createCheckpointId(),
      label,
      title: draft.title,
      comment: draft.comment,
      createdAt: new Date().toISOString(),
    }

    setCheckpoints((currentCheckpoints) => [checkpoint, ...currentCheckpoints].slice(0, MAX_CHECKPOINTS))
    setActiveCheckpointId(checkpoint.id)
    setSelectedCheckpointId(checkpoint.id)
    setCheckpointLabel('')
    showActionStatus(`Saved checkpoint "${label}"`)
  }

  const loadCheckpoint = (checkpoint) => {
    const shouldLoad = window.confirm(
      `Load checkpoint "${checkpoint.label}" into the editor? Your current autosaved draft will be replaced.`,
    )
    if (!shouldLoad) return

    setDraft({
      title: checkpoint.title,
      comment: checkpoint.comment,
    })
    setActiveCheckpointId(checkpoint.id)
    showActionStatus(`Loaded checkpoint "${checkpoint.label}"`)
  }

  const deleteCheckpoint = (checkpoint) => {
    const shouldDelete = window.confirm(`Delete checkpoint "${checkpoint.label}"?`)
    if (!shouldDelete) return

    setCheckpoints((currentCheckpoints) =>
      currentCheckpoints.filter((currentCheckpoint) => currentCheckpoint.id !== checkpoint.id),
    )
    if (activeCheckpointId === checkpoint.id) {
      setActiveCheckpointId(null)
    }
    if (selectedCheckpointId === checkpoint.id) {
      setSelectedCheckpointId('')
    }
    showActionStatus(`Deleted checkpoint "${checkpoint.label}"`)
  }

  const loadSelectedCheckpoint = () => {
    if (selectedCheckpoint) {
      loadCheckpoint(selectedCheckpoint)
    }
  }

  const deleteSelectedCheckpoint = () => {
    if (selectedCheckpoint) {
      deleteCheckpoint(selectedCheckpoint)
    }
  }

  const resetDraft = () => {
    if (!window.confirm('Reset the current autosaved draft? Checkpoints will stay saved.')) return
    localStorage.removeItem(DRAFT_KEY)
    setDraft(defaultDraft)
    setActiveCheckpointId(null)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span>OpenReview Editor</span>
        </div>
      </header>

      <main className="workspace">
        <section className="compact-status">
          <h1>New Official Comment</h1>
          <div className="save-state" aria-live="polite">
            <Save size={16} aria-hidden="true" />
            {lastSavedAt ? `Draft saved ${lastSavedAt.toLocaleTimeString()}` : 'Draft not saved yet'}
          </div>
        </section>

        <section className="draft-tools" aria-label="Draft controls">
          <div className="title-control">
            <label className="field-label" htmlFor="title">
              Title
            </label>
            <input
              id="title"
              className="text-input"
              value={draft.title}
              onChange={(event) => updateDraft('title', event.target.value)}
            />
          </div>

          <div className="checkpoint-section" aria-labelledby="checkpoints-heading">
            <div className="checkpoint-header">
              <div>
                <h2 id="checkpoints-heading">Checkpoints</h2>
                {activeCheckpoint && (
                  <p className="active-checkpoint">Current: {activeCheckpoint.label}</p>
                )}
              </div>
              <span className="checkpoint-count">
                {checkpoints.length}/{MAX_CHECKPOINTS}
              </span>
            </div>

            <div className="checkpoint-controls">
              <form className="checkpoint-form" onSubmit={saveCheckpoint}>
                <input
                  className="text-input checkpoint-input"
                  aria-label="Checkpoint label"
                  maxLength={MAX_CHECKPOINT_LABEL_LENGTH}
                  placeholder="Label current draft"
                  value={checkpointLabel}
                  onChange={(event) => setCheckpointLabel(event.target.value)}
                />
                <button
                  type="submit"
                  className="secondary-button checkpoint-save-button"
                  disabled={!checkpointLabel.trim() || isDraftEmpty}
                >
                  <Save size={16} aria-hidden="true" />
                  Save
                </button>
              </form>

              <div className="checkpoint-loader">
                <select
                  className="checkpoint-select"
                  aria-label="Saved checkpoint"
                  value={selectedCheckpointId}
                  onChange={(event) => setSelectedCheckpointId(event.target.value)}
                  disabled={checkpoints.length === 0}
                >
                  {checkpoints.length === 0 ? (
                    <option value="">No checkpoints saved</option>
                  ) : (
                    checkpoints.map((checkpoint) => (
                      <option value={checkpoint.id} key={checkpoint.id}>
                        {checkpoint.label} · {formatCheckpointDate(checkpoint.createdAt)} ·{' '}
                        {checkpoint.comment.trim().length}/{MAX_COMMENT_LENGTH}
                      </option>
                    ))
                  )}
                </select>
                <button
                  type="button"
                  className="icon-button"
                  onClick={loadSelectedCheckpoint}
                  disabled={!selectedCheckpoint}
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  Load
                </button>
                <button
                  type="button"
                  className="icon-button danger-button"
                  onClick={deleteSelectedCheckpoint}
                  disabled={!selectedCheckpoint}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  Delete
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={copySelectedCheckpointShareLink}
                  disabled={!selectedCheckpoint || !isCheckpointSharingSupported}
                  title={
                    isCheckpointSharingSupported
                      ? 'Copy encrypted checkpoint link'
                      : 'Encrypted checkpoint links are not supported in this browser'
                  }
                >
                  <Share2 size={16} aria-hidden="true" />
                  Share
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="editor-section">
          <div className="section-header">
            <div>
              <h2>
                Comment<span aria-hidden="true">*</span>
              </h2>
              <p>
                Your comment or reply (max 5000 characters). Add formatting using Markdown and
                formulas using LaTeX.
              </p>
            </div>
            <div className={remainingCharacters < 0 ? 'counter over-limit' : 'counter'}>
              {commentLength}/{MAX_COMMENT_LENGTH}
            </div>
          </div>

          {hasLikelyUnescapedTexLineBreak(draft.comment) && (
            <div className="tex-warning" role="alert">
              <strong>IMPORTANT:</strong> OpenReview requires all uses of "\\" in LaTeX formulas
              to be replaced with "\\\\".
            </div>
          )}

          <div className="split-editor">
            <div className="pane">
              <div className="pane-header">
                <div>
                  <SplitSquareHorizontal size={18} aria-hidden="true" />
                  Write
                </div>
                <button type="button" className="icon-button" onClick={copyMarkdown}>
                  <Copy size={16} aria-hidden="true" />
                  Copy Markdown
                </button>
              </div>
              <textarea
                className="comment-input"
                aria-label="Official comment Markdown"
                value={draft.comment}
                onChange={(event) => updateDraft('comment', event.target.value)}
                spellCheck="true"
              />
              <div className="tex-link">
                <FileText size={15} aria-hidden="true" />
                <a
                  href="https://docs.openreview.net/reference/openreview-tex"
                  target="_blank"
                  rel="noreferrer"
                >
                  TeX is supported
                </a>
              </div>
            </div>

            <div className="pane">
              <div className="pane-header">
                <div>
                  <FileText size={18} aria-hidden="true" />
                  Preview
                </div>
                <button type="button" className="icon-button" onClick={copyPayload}>
                  <Copy size={16} aria-hidden="true" />
                  Copy Payload
                </button>
              </div>
              <MarkdownPreview html={previewHtml} />
            </div>
          </div>
        </section>

        <footer className="footer-actions">
          <button type="button" className="secondary-button" onClick={resetDraft}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset Draft
          </button>
          <button type="button" className="primary-button" onClick={copyMarkdown}>
            <Check size={16} aria-hidden="true" />
            Copy Comment for OpenReview
          </button>
          {actionStatus && <span className="action-status">{actionStatus}</span>}
        </footer>
      </main>
    </div>
  )
}

export default App

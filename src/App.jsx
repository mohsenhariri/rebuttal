import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  FileText,
  RotateCcw,
  Save,
  SplitSquareHorizontal,
  Trash2,
} from 'lucide-react'
import { hasLikelyUnescapedTexLineBreak, renderOpenReviewMarkdown } from './openreviewMarkdown.js'

const DRAFT_KEY = 'oply-rebuttal-draft-v1'
const CHECKPOINTS_KEY = 'oply-rebuttal-checkpoints-v1'
const MAX_COMMENT_LENGTH = 5000
const MAX_CHECKPOINTS = 50
const MAX_CHECKPOINT_LABEL_LENGTH = 80

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

  const commentLength = draft.comment.trim().length
  const remainingCharacters = MAX_COMMENT_LENGTH - commentLength
  const isDraftEmpty = draft.title.trim().length === 0 && draft.comment.trim().length === 0
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

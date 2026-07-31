import React, { useMemo } from "react"
import type { ComponentPropsWithoutRef } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import remarkGfm from "remark-gfm"
import type { Components, ExtraProps, UrlTransform } from "react-markdown"
import { CodeBlock } from "./CodeBlock"
import { ideBridge } from "../lib/ideBridge"
import { getGeneratedImageUrl } from "../lib/fileUtils"
import { useProjectOptional } from "../state/ProjectContext"
import { ImagePreview, ImagePreviewLinkContext } from "./parts/ImagePreview"

interface MarkdownRendererProps {
  children: string
  inline?: boolean
  tone?: "default" | "muted"
}

// Common className patterns for consistency and maintainability
const defaultStyles = {
  text: "text-gray-900 dark:text-gray-100",
  textMuted: "text-gray-800 dark:text-gray-200",
  textDim: "text-gray-600 dark:text-gray-400",
  border: "border-gray-300 dark:border-gray-700",
  bg: "bg-gray-50 dark:bg-gray-800/50",
  bgAlt: "bg-gray-100 dark:bg-gray-800",
}

const mutedStyles = {
  text: "text-gray-600 dark:text-gray-400",
  textMuted: "text-gray-600 dark:text-gray-400",
  textDim: "text-gray-500 dark:text-gray-500",
  border: "border-gray-300 dark:border-gray-700",
  bg: "bg-gray-50 dark:bg-gray-800/50",
  bgAlt: "bg-gray-100 dark:bg-gray-800",
}

const generatedImagesPrefix = ".opencode/generated-images/"

function generatedImagePath(src: string | undefined) {
  if (!src) return ""

  const decoded = (() => {
    try {
      return decodeURIComponent(src)
    } catch {
      return src
    }
  })()
  const normalized = decoded.replaceAll("\\", "/")
  const relative = normalized.startsWith(`./${generatedImagesPrefix}`)
    ? normalized.slice(2)
    : normalized.startsWith(`..${generatedImagesPrefix.slice(1)}`)
      ? normalized.slice(1)
      : normalized
  if (relative.startsWith(generatedImagesPrefix)) return relative

  return ""
}

function resolveImageSrc(src: string | undefined, directory: string | null | undefined) {
  const relative = generatedImagePath(src)
  if (relative) return getGeneratedImageUrl(relative, directory)

  return src || ""
}

function imageName(src: string) {
  const path = src.split(/[?#]/)[0] ?? ""
  const segment = path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)
  if (!segment) return "image"
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function createUrlTransform(): UrlTransform {
  return (url, key) => {
    if (key === "src") {
      const relative = generatedImagePath(url)
      if (relative) return relative
      if (/^data:image\/[a-z0-9.+-]+(?:[;,]|$)/i.test(url)) return url
      if (/^blob:/i.test(url)) return url
    }

    return defaultUrlTransform(url)
  }
}

// Custom components for styled markdown elements
const blockTags = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "canvas",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "noscript",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tfoot",
  "ul",
])

function hasBlockChild(children: React.ReactNode): boolean {
  const arr = React.Children.toArray(children)
  for (const child of arr) {
    if (!React.isValidElement(child)) continue
    const childType = child.type
    if (childType === CodeBlock && !(child.props as { inline?: boolean }).inline) return true
    if (typeof childType === "string" && blockTags.has(childType)) return true
    if (childType === React.Fragment) {
      const fragmentChildren = (child.props as { children?: React.ReactNode }).children
      if (hasBlockChild(fragmentChildren)) return true
    }
  }
  return false
}

interface RemarkNode {
  tagName?: string
  children?: unknown
}

function remarkNodeHasBlock(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const node = value as RemarkNode
  const tagName = typeof node.tagName === "string" ? node.tagName : undefined
  if (tagName && blockTags.has(tagName)) return true
  const childList = Array.isArray(node.children) ? node.children : []
  for (const child of childList) {
    if (remarkNodeHasBlock(child)) return true
  }
  return false
}

function remarkNodeHasBlockChild(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const node = value as RemarkNode
  const childList = Array.isArray(node.children) ? node.children : []
  for (const child of childList) {
    if (remarkNodeHasBlock(child)) return true
  }
  return false
}

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> &
  ExtraProps & {
    inline?: boolean
  }

function createMarkdownComponents(
  styles: typeof defaultStyles,
  tone: "default" | "muted",
  directory: string | null | undefined,
): Partial<Components> {
  return {
    // Headings with proper hierarchy
    h1: ({ children }) => <h1 className={`text-2xl font-bold mb-2 mt-3 ${styles.text}`}>{children}</h1>,
    h2: ({ children }) => <h2 className={`text-xl font-bold mb-1.5 mt-2.5 ${styles.text}`}>{children}</h2>,
    h3: ({ children }) => <h3 className={`text-lg font-bold mb-1.5 mt-2 ${styles.text}`}>{children}</h3>,
    h4: ({ children }) => <h4 className={`text-base font-bold mb-1 mt-1.5 ${styles.text}`}>{children}</h4>,
    h5: ({ children }) => <h5 className={`text-sm font-bold mb-1 mt-1.5 ${styles.text}`}>{children}</h5>,
    h6: ({ children }) => <h6 className={`text-xs font-bold mb-1 mt-1.5 ${styles.text}`}>{children}</h6>,

    // Lists with proper indentation
    ul: ({ children }) => <ul className={`list-disc list-inside mb-1.5 space-y-0.5 ${styles.text}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`list-decimal list-inside mb-1.5 space-y-0.5 ${styles.text}`}>{children}</ol>,
    li: ({ children }) => <li className={`ml-4 ${styles.text}`}>{children}</li>,

    // Blockquotes with left border
    blockquote: ({ children }) => (
      <blockquote
        className={`border-l-4 border-gray-300 dark:border-gray-600 pl-4 my-3 ${styles.bg} py-2 italic ${styles.textMuted}`}
      >
        {children}
      </blockquote>
    ),

    // Code blocks and inline code with syntax highlighting
    code: (props: MarkdownCodeProps) => {
      const { inline, className, children, node } = props
      // hack for inline code, `text` in MD is not marked as inline
      const isInline = inline ?? node?.position?.start.line === node?.position?.end.line

      // Extract language from className (format: language-xxx)
      const match = /language-([\w-]+)/.exec(className || "")
      const language = match ? match[1] : ""

      // Convert children to string
      const value = String(children).replace(/\n$/, "")

      return <CodeBlock language={language} value={value} inline={isInline} tone={tone} />
    },

    // Paragraphs
    p: (props) => {
      const nodeHasBlock = remarkNodeHasBlockChild(props.node)
      if (nodeHasBlock) {
        return <div className={`mb-1.5 ${styles.text} leading-relaxed`}>{props.children}</div>
      }
      const childHasBlock = hasBlockChild(props.children)
      if (childHasBlock) {
        return <div className={`mb-1.5 ${styles.text} leading-relaxed`}>{props.children}</div>
      }
      return <p className={`mb-1.5 ${styles.text} leading-relaxed`}>{props.children}</p>
    },

    // Links that open in new tab (via IDE bridge when in JCEF to avoid hangs)
    a: ({ href, children }) => {
      const handleClick = (e: React.MouseEvent) => {
        if (href && ideBridge.isInstalled()) {
          e.preventDefault()
          ideBridge.send({ type: "openUrl", payload: { url: href } })
        }
      }
      const cls =
        tone === "muted"
          ? `${styles.text} underline decoration-gray-500 hover:opacity-90`
          : "text-blue-600 dark:text-blue-400 hover:underline"
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls} onClick={handleClick}>
          <ImagePreviewLinkContext.Provider value>{children}</ImagePreviewLinkContext.Provider>
        </a>
      )
    },

    img: ({ src, alt }) => {
      const resolved = resolveImageSrc(src, directory)
      if (!resolved) return null

      return <ImagePreview src={resolved} alt={alt ?? ""} filename={alt || imageName(src || resolved)} />
    },

    // Tables with borders and striped rows
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className={`min-w-full border ${styles.border}`}>{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className={styles.bgAlt}>{children}</thead>,
    tbody: ({ children }) => <tbody>{children}</tbody>,
    tr: ({ children }) => <tr className={`border-b ${styles.border} hover:${styles.bg}`}>{children}</tr>,
    th: ({ children }) => (
      <th className={`px-4 py-2 text-left font-bold ${styles.text} border-r ${styles.border} last:border-r-0`}>
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className={`px-4 py-2 ${styles.text} border-r ${styles.border} last:border-r-0`}>{children}</td>
    ),

    // Horizontal rule
    hr: () => <hr className={`my-4 border-t ${styles.border}`} />,

    // Strong (bold)
    strong: ({ children }) => <strong className={`font-bold ${styles.text}`}>{children}</strong>,

    // Emphasis (italic)
    em: ({ children }) => <em className={`italic ${styles.text}`}>{children}</em>,

    // Delete (strikethrough) - from GFM
    del: ({ children }) => <del className={`line-through ${styles.textDim}`}>{children}</del>,
  }
}

function createInlineComponents(
  styles: typeof defaultStyles,
  tone: "default" | "muted",
  directory: string | null | undefined,
): Partial<Components> {
  return {
    ...createMarkdownComponents(styles, tone, directory),
    p: ({ children }) => <span>{children}</span>,
    h1: ({ children }) => <span className={`font-bold ${styles.text}`}>{children}</span>,
    h2: ({ children }) => <span className={`font-bold ${styles.text}`}>{children}</span>,
    h3: ({ children }) => <span className={`font-bold ${styles.text}`}>{children}</span>,
    h4: ({ children }) => <span className={`font-bold ${styles.text}`}>{children}</span>,
    h5: ({ children }) => <span className={`font-bold ${styles.text}`}>{children}</span>,
    h6: ({ children }) => <span className={`font-bold ${styles.text}`}>{children}</span>,
    ul: ({ children }) => <span>{children}</span>,
    ol: ({ children }) => <span>{children}</span>,
    li: ({ children }) => <span className={`${styles.text} before:content-['•_']`}>{children}</span>,
    blockquote: ({ children }) => <span className={`italic ${styles.textMuted}`}>{children}</span>,
    hr: () => <span className="mx-1">—</span>,
    table: ({ children }) => <span>{children}</span>,
    thead: ({ children }) => <span>{children}</span>,
    tbody: ({ children }) => <span>{children}</span>,
    tr: ({ children }) => <span>{children}</span>,
    th: ({ children }) => <span className={`font-bold ${styles.text}`}>{children} </span>,
    td: ({ children }) => <span className={styles.text}>{children} </span>,
  }
}

export function MarkdownRenderer({ children, inline, tone = "default" }: MarkdownRendererProps) {
  const project = useProjectOptional()
  const directory = project?.directory ?? project?.worktree ?? null
  const styles = tone === "muted" ? mutedStyles : defaultStyles
  const components = useMemo(
    () =>
      inline
        ? createInlineComponents(styles, tone, directory)
        : createMarkdownComponents(styles, tone, directory),
    [directory, inline, styles, tone],
  )
  const urlTransform = createUrlTransform()
  if (inline) {
    return (
      <span className="markdown-content inline break-words [overflow-wrap:anywhere]">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
          {children}
        </ReactMarkdown>
      </span>
    )
  }
  return (
    <div className="markdown-content break-words [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {children}
      </ReactMarkdown>
    </div>
  )
}

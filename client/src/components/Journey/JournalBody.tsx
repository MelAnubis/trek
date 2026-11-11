import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

interface Props {
  text: string
  dark?: boolean
}

export default function JournalBody({ text, dark }: Props) {
  return (
    <div className="journal-body ![font-family:inherit] !text-[length:inherit] !leading-[1.6] ![color:inherit]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => <p className="!m-[0_0_6px]">{children}</p>,
          h2: ({ children }) => <p className="!m-[0_0_6px]">{children}</p>,
          h3: ({ children }) => <p className="!m-[0_0_6px]">{children}</p>,
          p: ({ children }) => <p className="!m-[0_0_6px]">{children}</p>,
          blockquote: ({ children }) => (
            <blockquote className="![border-left:3px_solid_var(--journal-accent)] !pl-[16px] !m-[12px_0] !italic ![color:var(--journal-muted)]">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a className="![color:var(--journal-accent)] ![text-decoration:underline] ![text-underline-offset:2px]" href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="!pl-[20px] !m-[8px_0]">{children}</ul>,
          ol: ({ children }) => <ol className="!pl-[20px] !m-[8px_0]">{children}</ol>,
          li: ({ children }) => <li className="!m-[4px_0]">{children}</li>,
          strong: ({ children }) => <strong className="!font-[600]">{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          hr: () => <hr className="![border:none] [&&]:![border-top:1px_solid_var(--journal-border)] !m-[20px_0]" />,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-')
            if (isBlock) {
              return (
                <pre className="!rounded-[8px] !p-[14px] !overflow-x-auto !text-[length:13px] ![font-family:monospace] !m-[12px_0]" style={{ background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)' }}>
                  <code>{children}</code>
                </pre>
              )
            }
            return (
              <code className="!rounded-[4px] !p-[2px_5px] !text-[length:0.9em] ![font-family:monospace]" style={{ background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>{children}</code>
            )
          },
        }}
      >
        {text.replace(/^(.+)\n([-=]{3,})$/gm, '$1\n\n$2')}
      </ReactMarkdown>
    </div>
  )
}

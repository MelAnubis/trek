// FE-PRINTSHEETS-001
import { printSheets } from './printSheets'

describe('printSheets', () => {
  afterEach(() => {
    document.querySelector('#bx-overlay')?.remove()
  })

  it('FE-PRINTSHEETS-001: resets html/body height+overflow so the host app\'s scroll-lock shell (index.css) can\'t clip multi-sheet pagination', () => {
    const close = printSheets({
      html: '<div class="bx-book"><div class="bx-sheet"></div></div>',
      sheetWidth: 210,
      sheetHeight: 297,
      title: 'Test book',
      labels: { save: 'Save', close: 'Close', count: '1 sheet', preparing: 'Preparing' },
    })

    const iframe = document.querySelector<HTMLIFrameElement>('#bx-overlay iframe')
    expect(iframe).toBeTruthy()
    const doc = iframe!.srcdoc

    // The print-media block must explicitly reset overflow/height — a rule
    // that only sets background (the old code) leaves the host's
    // html{height:100%;overflow:hidden} (copied in wholesale by
    // collectStyles()) in force, which clips every sheet past the first
    // instead of letting break-after:page paginate them.
    const printBlockMatch = doc.match(/@media print\s*\{([\s\S]*?)\n\s*\}\n\s*<\/style>/)
    expect(printBlockMatch).toBeTruthy()
    const printBlock = printBlockMatch![1]
    expect(printBlock).toMatch(/html,\s*body\s*\{[^}]*overflow:\s*visible/)
    expect(printBlock).toMatch(/html,\s*body\s*\{[^}]*height:\s*auto/)

    close()
  })
})

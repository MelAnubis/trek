import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../tests/helpers/render';
import { resetAllStores } from '../../../tests/helpers/store';
import AboutTab from './AboutTab';

beforeEach(() => {
  resetAllStores();
  vi.clearAllMocks();
});

describe('AboutTab', () => {
  it('FE-COMP-ABOUT-001: renders without crashing', () => {
    render(<AboutTab appVersion="2.9.10" />);
    expect(document.body).toBeInTheDocument();
  });

  it('FE-COMP-ABOUT-002: displays the version badge', () => {
    render(<AboutTab appVersion="2.9.10" />);
    expect(screen.getByText('v2.9.10')).toBeInTheDocument();
  });

  it('FE-COMP-ABOUT-003: links only to this fork\'s own repo — no upstream donation or chat links', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const hrefs = Array.from(document.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
    expect(hrefs.length).toBeGreaterThan(0);
    hrefs.forEach(h => expect(h.startsWith('https://github.com/MelAnubis/trek')).toBe(true));
    expect(screen.queryByText('Ko-fi')).toBeNull();
    expect(screen.queryByText('Buy Me a Coffee')).toBeNull();
    expect(screen.queryByText('Discord')).toBeNull();
  });

  it('FE-COMP-ABOUT-006: displays bug report link', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const link = document.querySelector('a[href*="issues/new"]');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      'href',
      'https://github.com/MelAnubis/trek/issues/new',
    );
  });

  it('FE-COMP-ABOUT-007: displays feature request link', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const link = document.querySelector('a[href$="/discussions"]');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('FE-COMP-ABOUT-008: displays wiki link', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const link = document.querySelector('a[href*="wiki"]');
    expect(link).toBeInTheDocument();
  });

  it('FE-COMP-ABOUT-009: all external links have rel="noopener noreferrer"', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const links = document.querySelectorAll('a');
    expect(links).toHaveLength(3);
    links.forEach((link) => {
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  it('FE-COMP-ABOUT-010: all external links open in a new tab', () => {
    render(<AboutTab appVersion="2.9.10" />);
    const links = document.querySelectorAll('a');
    links.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank');
    });
  });

  it('FE-COMP-ABOUT-011: version prop change is reflected', () => {
    render(<AboutTab appVersion="1.0.0" />);
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.queryByText('v2.9.10')).toBeNull();
  });

  it('FE-COMP-ABOUT-015: Bug report link has CSS hover classes for border and box-shadow', () => {
    render(<AboutTab appVersion="1.0.0" />);
    const link = document.querySelector('a[href*="issues/new"]') as HTMLAnchorElement;
    // The hover look is CSS now (styles/hover.css): a border-color and a box-shadow class.
    expect(link.className).toMatch(/trek-h-border-color-/);
    expect(link.className).toMatch(/trek-h-box-shadow-/);
  });

  it('FE-COMP-ABOUT-016: Feature request link has CSS hover classes for border and box-shadow', () => {
    render(<AboutTab appVersion="1.0.0" />);
    const link = document.querySelector('a[href$="/discussions"]') as HTMLAnchorElement;
    // The hover look is CSS now (styles/hover.css): a border-color and a box-shadow class.
    expect(link.className).toMatch(/trek-h-border-color-/);
    expect(link.className).toMatch(/trek-h-box-shadow-/);
  });

  it('FE-COMP-ABOUT-017: Wiki link has CSS hover classes for border and box-shadow', () => {
    render(<AboutTab appVersion="1.0.0" />);
    const link = document.querySelector('a[href*="wiki"]') as HTMLAnchorElement;
    // The hover look is CSS now (styles/hover.css): a border-color and a box-shadow class.
    expect(link.className).toMatch(/trek-h-border-color-/);
    expect(link.className).toMatch(/trek-h-box-shadow-/);
  });
});

const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');
const resolve = require('resolve');
const detectIndent = require('detect-indent');
const flatten = require('lodash/flatten');
const UglifyJS = require('uglify-js');

/**
 * Get loadcss + cssrelpreload script
 *
 * @returns {string} Minified loadcss script
 */
function getScript() {
  const loadCssMain = resolve.sync('fg-loadcss');
  const loadCssBase = path.dirname(loadCssMain);

  const loadCSS = fs.readFileSync(path.join(loadCssBase, 'cssrelpreload.js'), 'utf8');
  return UglifyJS.minify(loadCSS).code.trim();
}

/**
 * Get all subsctings of of the passed tags
 * Does not work with self closing tags
 * @param {string} html Html string
 * @param {string} tag Tagname
 * @returns {array<string>} Array with aöö substrings
 */
const getPartials = (html = '', tag = 'svg') => {
  const indices = [];
  let start = html.indexOf(`<${tag}`, 0);
  let end = html.indexOf(`</${tag}>`, start) + `</${tag}>`.length;
  while (start >= 0) {
    indices.push({start, end});
    start = html.indexOf(`<${tag}`, end);
    end = html.indexOf(`</${tag}>`, end) + `</${tag}>`.length;
  }

  return indices.map(({start, end}) => html.substring(start, end));
};

/**
 * Replace all partials defined by tagname in source with the corresponding
 * partials found in dest
 * @param {string} source Source HTML String
 * @param {string} dest Dest HTML String
 * @param {string} tag Tagname (svg or math)
 * @returns {array} SVG Strings found in HTML
 */
const replacePartials = (source, dest, tag) => {
  if (!Array.isArray(tag)) {
    tag = [tag];
  }

  return tag.reduce((result, tag) => {
    // Only replace head so we don't mess with the orignal markup
    const newTags = getPartials(dest, tag);
    const oldTags = getPartials(result, tag);

    return oldTags.reduce((str, code, index) => str.replace(code, newTags[index] || code), result);
  }, source);
};

class Dom {
  constructor(html, {minify = true} = {}) {
    const jsdom = new JSDOM(html);
    const {window} = jsdom;
    const {document} = window;
    document.$jsdom = jsdom;

    this.minify = minify;
    this.html = html;
    this.document = document;
    this.window = window;
    this.jsdom = jsdom;

    this.indent = detectIndent(html);
    this.headIndent = detectIndent(this.document.querySelector('head').innerHTML);
  }

  serialize() {
    const html = this.jsdom.serialize();

    // Only replace head so we don't mess with the orignal markup
    // See https://github.com/fb55/htmlparser2/pull/259 (htmlparser2)
    // See https://runkit.com/582b0e9ebe07a80014bf1e82/58400d2db3ef0f0013bae090 (parse5)
    // The current parsers have problems with foreign context elements like svg & math
    return replacePartials(this.html, html, 'head');
  }

  createStyleNode(css, referenceIndent = this.headIndent.indent) {
    if (this.minify) {
      const styles = this.document.createElement('style');
      styles.append(this.document.createTextNode(css));
      return styles;
    }

    const textIndent = String(referenceIndent + this.indent.indent);
    const text = css
      .trim()
      .split(/[\r\n]+/)
      .join(`\n${textIndent}`);

    const styles = this.document.createElement('style');
    styles.append(this.document.createTextNode('\n' + textIndent + text + '\n' + referenceIndent));
    return styles;
  }

  createElement(tag) {
    return this.document.createElement(tag);
  }

  getInlineStyles() {
    return [...this.document.querySelectorAll('head style')].map(node => node.textContent);
  }

  getExternalStyles() {
    return [...this.document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]')].filter(
      link => link.parentElement.tagName !== 'NOSCRIPT'
    );
  }

  querySelector(...selector) {
    const s = flatten(selector)
      .filter(s => s)
      .join(',');

    return this.document.querySelector(s);
  }

  querySelectorAll(...selector) {
    const s = flatten(selector)
      .filter(s => s)
      .join(',');

    return this.document.querySelectorAll(s);
  }

  addInlineStyles(css, target) {
    if (target) {
      this.insertStylesBefore(css, target);
    } else {
      this.appendStyles(css, this.querySelector('head'));
    }
  }

  insertStylesBefore(css, referenceNode) {
    const styles = this.createStyleNode(css);
    referenceNode.before(styles);
    styles.after(this.document.createTextNode('\n' + this.headIndent.indent));
  }

  appendStyles(css, referenceNode) {
    const styles = this.createStyleNode(css);
    referenceNode.append(styles);
    styles.before(this.document.createTextNode(this.headIndent.indent));
    styles.after(this.document.createTextNode('\n' + this.headIndent.indent));
  }

  insertBefore(node, referenceNode) {
    referenceNode.before(node);
    node.after(this.document.createTextNode('\n' + this.headIndent.indent));
  }

  insertAfter(node, referenceNode) {
    referenceNode.after(node);
    referenceNode.after(this.document.createTextNode('\n' + this.headIndent.indent));
  }

  remove(node) {
    while (
      node.previousSibling &&
      node.previousSibling.nodeName === '#text' &&
      node.previousSibling.textContent.trim() === ''
    ) {
      node.previousSibling.remove();
    }
    node.remove();
  }

  maybeAddLoadcss() {
    // Only add loadcss if it's not already included
    const loadCssIncluded = [...this.document.querySelectorAll('script')].some(tag =>
      (tag.textContent || '').includes('loadCSS')
    );

    if (loadCssIncluded) {
      return;
    }

    // Add loadcss + cssrelpreload polyfill
    const nodes = [
      ...this.document.querySelectorAll('head link[rel="stylesheet"],head link[rel="preload"],head noscript'),
    ].filter(link => link.parentElement.tagName !== 'NOSCRIPT');
    const scriptAnchor = nodes.pop();
    const script = this.document.createElement('script');
    script.append(this.document.createTextNode(getScript()));

    if (scriptAnchor) {
      scriptAnchor.after(script);
      scriptAnchor.after(this.document.createTextNode('\n' + this.headIndent.indent));
    }
  }
}

module.exports = Dom;

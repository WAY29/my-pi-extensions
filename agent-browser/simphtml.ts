import { parseHTML } from 'linkedom';

export const jsOptHtml = String.raw`function optHTML(text_only=false) {
function createEnhancedDOMCopy() {  
  const nodeInfo = new WeakMap();  
  const ignoreTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'COLGROUP', 'COL', 'TEMPLATE', 'PARAM', 'SOURCE'];  
  const ignoreIds = ['ljq-ind', 'pi-agent-browser-indicator'];  
  function cloneNode(sourceNode, keep=false) {  
    if (sourceNode.nodeType === 8 ||   
        (sourceNode.nodeType === 1 && (  
          ignoreTags.includes(sourceNode.tagName) ||   
          (sourceNode.id && ignoreIds.includes(sourceNode.id))  
        ))) {  
      return null;  
    }  
    if (sourceNode.nodeType === 3) return sourceNode.cloneNode(false);  
    const clone = sourceNode.cloneNode(false);
    if ((sourceNode.tagName === 'INPUT' || sourceNode.tagName === 'TEXTAREA') && sourceNode.value) clone.setAttribute('value', sourceNode.value);
    if (sourceNode.tagName === 'INPUT' && (sourceNode.type === 'radio' || sourceNode.type === 'checkbox') && sourceNode.checked) clone.setAttribute('checked', '');
    else if (sourceNode.tagName === 'SELECT' && sourceNode.value) clone.setAttribute('data-selected', sourceNode.value);  
    try { if (sourceNode.matches && sourceNode.matches(':-webkit-autofill')) { clone.setAttribute('data-autofilled', 'true'); if (!sourceNode.value) clone.setAttribute('value', '⚠️受保护-读tmwebdriver_sop的autofill章节提取'); } } catch(e) {}

    const isDropdown = sourceNode.classList?.contains('dropdown-menu') ||   
             /dropdown|menu/i.test(sourceNode.className) || sourceNode.getAttribute('role') === 'menu'; 
    const _ddItems = isDropdown ? sourceNode.querySelectorAll('a, button, [role="menuitem"], li').length : 0;
    const isSmallDropdown = _ddItems > 0 && _ddItems <= 7 && sourceNode.textContent.length < 500;  

    const childNodes = [];  
    for (const child of sourceNode.childNodes) {  
      const childClone = cloneNode(child, keep || isSmallDropdown);  
      if (childClone) childNodes.push(childClone);  
    }  
    if (sourceNode.tagName === 'IFRAME') {
      try {
        const iDoc = sourceNode.contentDocument || sourceNode.contentWindow?.document;
        if (iDoc && iDoc.body && iDoc.body.children.length > 0) {
          const wrapper = document.createElement('div');
          wrapper.setAttribute('data-iframe-content', sourceNode.src || '');
          for (const ch of iDoc.body.childNodes) {
            const c = cloneNode(ch, keep);
            if (c) wrapper.appendChild(c);
          }
          if (wrapper.childNodes.length) childNodes.push(wrapper);
        }
      } catch(e) {}
    }
    if (sourceNode.shadowRoot) {
      for (const shadowChild of sourceNode.shadowRoot.childNodes) {
        const shadowClone = cloneNode(shadowChild, keep);
        if (shadowClone) childNodes.push(shadowClone);
      }
    }

    const rect = sourceNode.getBoundingClientRect();
    const style = window.getComputedStyle(sourceNode);
    const area = (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) <= 0)?0:rect.width * rect.height;
    const isVisible = (rect.width > 1 && rect.height > 1 &&   
                  style.display !== 'none' && style.visibility !== 'hidden' &&   
                  parseFloat(style.opacity) > 0 &&  
                  Math.abs(rect.left) < 5000 && Math.abs(rect.top) < 5000) 
                  || isSmallDropdown;  
    const zIndex = style.position !== 'static' ? (parseInt(style.zIndex) || 0) : 0;
  
    let info = {
          rect, area, isVisible, isSmallDropdown, zIndex,
          style: {  
            display: style.display, visibility: style.visibility,  
            opacity: style.opacity, position: style.position
          }};
    
    const nonTextChildren = childNodes.filter(child => child.nodeType !== 3);  
    const hasValidChildren = nonTextChildren.length > 0;  
          
    if (hasValidChildren) {
      const childrenInfos = nonTextChildren.map(c => nodeInfo.get(c)).filter(i => i && i.rect && i.rect.width > 0 && i.rect.height > 0);
      const bgAlpha = (() => {
        const c = style.backgroundColor;
        if (!c || c === 'transparent') return 0;
        const m = c.match(/rgba?\([^)]+,\s*([\d.]+)\)/);
        return m ? parseFloat(m[1]) : 1;
      })();
      const hasVisualBg = bgAlpha > 0.1 || style.backgroundImage !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none') || style.boxShadow !== 'none';
      
      if (!hasVisualBg && childrenInfos.length > 0) {
        let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
        for (const cInfo of childrenInfos) {
          minL = Math.min(minL, cInfo.rect.left);
          minT = Math.min(minT, cInfo.rect.top);
          maxR = Math.max(maxR, cInfo.rect.right);
          maxB = Math.max(maxB, cInfo.rect.bottom);
        }
        info.rect = { left: minL, top: minT, right: maxR, bottom: maxB, width: maxR - minL, height: maxB - minT };
        info.area = info.rect.width * info.rect.height;
      } else {
        const maxC = childrenInfos.filter(i => i.isVisible).sort((a, b) => b.area - a.area)[0];
        if (maxC && maxC.area > 10000 && (!isVisible || maxC.area > info.area * 5)) info = maxC;
      }
    }
    nodeInfo.set(clone, info);

    if (sourceNode.nodeType === 1 && sourceNode.tagName === 'DIV') {    
      if (!hasValidChildren && !sourceNode.textContent.trim()) return null; 
    }  
    if (sourceNode.getAttribute && sourceNode.getAttribute('aria-hidden') === 'true' && !info.isVisible) {
      return null;
    }
    if (info.isVisible || hasValidChildren || keep) {  
      childNodes.forEach(child => clone.appendChild(child));  
      return clone;  
    }  
    return null;  
  }  
  
  return {  
    domCopy: cloneNode(document.body),  
    getNodeInfo: node => nodeInfo.get(node),  
    isVisible: node => {  
      const info = nodeInfo.get(node);  
      return info && info.isVisible;  
    }  
  };  
}  
const { domCopy, getNodeInfo } = createEnhancedDOMCopy();
if (text_only) {
  const blocks = new Set(['DIV','P','H1','H2','H3','H4','H5','H6','LI','TR','SECTION','ARTICLE','HEADER','FOOTER','NAV','BLOCKQUOTE','PRE','HR','BR','DT','DD','FIGCAPTION','DETAILS','SUMMARY']);
  domCopy.querySelectorAll('*').forEach(el => {
    if (blocks.has(el.tagName)) el.insertAdjacentText('beforebegin', '\n');
  });
  domCopy.querySelectorAll('input:not([type=hidden]),textarea,select').forEach(el=>{
    const p=[el.tagName,el.id&&'#'+el.id,el.getAttribute('name')&&'name='+el.getAttribute('name'),el.tagName==='INPUT'&&'type='+(el.getAttribute('type')||'text'),el.getAttribute('placeholder')&&'"'+el.getAttribute('placeholder')+'"',el.getAttribute('data-autofilled')&&'autofilled',el.disabled&&'disabled',el.tagName==='SELECT'&&el.getAttribute('data-selected')&&'="'+el.getAttribute('data-selected')+'"'].filter(Boolean).join(' ');
    el.insertAdjacentText('beforebegin','\n['+p+']\n');
  });
  domCopy.querySelectorAll('button[disabled]').forEach(el=>el.insertAdjacentText('beforebegin','[DISABLED] '));
  return domCopy.textContent;
}
const viewportArea = window.innerWidth * window.innerHeight; 

function analyzeNode(node, pPathType='main') {  
    if (node.nodeType !== 1 || !node.children.length) {  
      node.nodeType === 1 && (node.dataset.mark = 'K:leaf');  
      return;  
    }  
    const pathType = (node.dataset.mark === 'K:secondary') ? 'second' : pPathType;  
    const nodeInfoData = getNodeInfo(node);
    if (!nodeInfoData || !nodeInfoData.rect) return;
    const rectn = nodeInfoData.rect; 
    if (rectn.width < window.innerWidth * 0.8 && rectn.height < window.innerHeight * 0.8) return node;
    if (node.tagName === 'TABLE') return;
    const children = Array.from(node.children);  
    if (children.length === 1) {  
      node.dataset.mark = 'K:container';  
      return analyzeNode(children[0], pathType);  
    }  
    if (children.length > 10) return;
    const childrenInfo = children.map(child => {  
      const info = getNodeInfo(child) || { rect: {}, style: {} };  
      return { node: child, rect: info.rect, style: info.style, 
          area: info.area, zIndex: (info.zIndex || 0), isVisible: info.isVisible };  
    });
    childrenInfo.sort((a, b) => b.area - a.area);  
    const isOverlay = hasOverlap(childrenInfo);  
    node.dataset.mark = isOverlay ? 'K:overlayParent' : 'K:partitionParent';  
    if (isOverlay) handleOverlayContainer(childrenInfo, pathType);  
    else handlePartitionContainer(childrenInfo, pathType);  
    for (const child of children)
      if (!child.dataset.mark || child.dataset.mark[0] !== 'R') analyzeNode(child, pathType);  
  }  
  
  function handlePartitionContainer(childrenInfo, pathType) {  
    childrenInfo.sort((a, b) => b.area - a.area);
    const totalArea = childrenInfo.reduce((sum, item) => sum + item.area, 0);  
    const hasMainElement = childrenInfo.length >= 1 &&   
                          (childrenInfo[0].area / totalArea > 0.5) &&   
                          (childrenInfo.length === 1 || childrenInfo[0].area > childrenInfo[1].area * 2);  
    if (hasMainElement) {  
      childrenInfo[0].node.dataset.mark = 'K:main';
      for (let i = 1; i < childrenInfo.length; i++) {  
        const child = childrenInfo[i];  
        let className = (child.node.getAttribute('class') || '').toLowerCase();
        let isSecondary = containsButton(child.node);
        if (className.includes('nav')) isSecondary = true;
        if (className.includes('breadcrumbs')) isSecondary = true;
        if (className.includes('header') && className.includes('table')) isSecondary = true;
        if (child.node.innerHTML.trim().replace(/\s+/g, '').length < 500) isSecondary = true;
        if (child.node.textContent.trim().length > 200) isSecondary = true;
        if (child.style.visibility === 'hidden') isSecondary = false;
        if (isSecondary) child.node.dataset.mark = 'K:secondary';  
        else child.node.dataset.mark = 'K:nonEssential';  
      }  
    } else {  
      return;
    }  
  }  

  function containsButton(container) {  
    const hasStandardButton = container.querySelector('button, input[type="button"], input[type="submit"], [role="button"]') !== null;  
    if (hasStandardButton) return true;  
    const hasClassButton = container.querySelector('[class*="-btn"], [class*="-button"], .button, .btn, [class*="btn-"]') !== null;  
    return hasClassButton;  
  }   
  
  function handleOverlayContainer(childrenInfo, pathType) {  
    const _efp = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
    if (_efp) { let _el = _efp; while (_el) { const _h = childrenInfo.find(c => c.node.id && c.node.id === _el.id); if (_h) { _h.zIndex = 9999; break; } _el = _el.parentElement; } }
    const sorted = [...childrenInfo].sort((a, b) => b.zIndex - a.zIndex);  
    if (sorted.length === 0) return;  
    const top = sorted[0];  
    const rect = top.rect;  
    const topNode = top.node; 
    const isComplex = top.node.querySelectorAll('input, select, textarea, button, a, [role="button"]').length >= 1;  
    const textContent = topNode.textContent?.trim() || '';  
    const textLength = textContent.length;  
    const hasLinks = topNode.querySelectorAll('a').length > 0;  
    const isMostlyText = textLength > 7 && !hasLinks;  
    const centerDiff = Math.abs((rect.left + rect.width/2) - window.innerWidth/2) / window.innerWidth;  
    const minDimensionRatio = Math.min(rect.width / window.innerWidth, rect.height / window.innerHeight);  
    const maxDimensionRatio = Math.max(rect.width / window.innerWidth, rect.height / window.innerHeight);  
    const isNearTop = rect.top < 50;  
    const isDialog = (top.node.querySelector('iframe') || top.node.querySelector('button') || top.node.querySelector('input')) && centerDiff < 0.3;

    if (isComplex && centerDiff < 0.2 && 
        ((minDimensionRatio > 0.2 && rect.width/window.innerWidth < 0.98) || minDimensionRatio > 0.95)) {  
      top.node.dataset.mark = 'K:mainInteractive';  
       sorted.slice(1).forEach(e => {
          if ((parseInt(e.zIndex)||0) <= (parseInt(sorted[0].zIndex)||0)) {
              e.node.dataset.mark = 'R:covered';
          } else {
              e.node.dataset.mark = 'K:noncovered';
          }
      });
    } else {
      if (isComplex && isNearTop && maxDimensionRatio > 0.4 && top.isVisible) {
        top.node.dataset.mark = 'K:topBar';
      } else if (isMostlyText || isComplex || isDialog) {  
        topNode.dataset.mark = 'K:messageContent'; 
      } else {  
        topNode.dataset.mark = 'R:floatingAd'; 
      }  
      const rest = sorted.slice(1);  
      rest.length && (!hasOverlap(rest) ? handlePartitionContainer(rest, pathType) : handleOverlayContainer(rest, pathType));  
    } 
  }  
    
  function hasOverlap(items) {  
    return items.some((a, i) =>   
      items.slice(i+1).some(b => {  
        const r1 = a.rect, r2 = b.rect;  
        if (!r1.width || !r2.width || !r1.height || !r2.height) {return false;}
        const epsilon = 1;
        const x1 = r1.x !== undefined ? r1.x : r1.left;
        const y1 = r1.y !== undefined ? r1.y : r1.top;
        const x2 = r2.x !== undefined ? r2.x : r2.left;
        const y2 = r2.y !== undefined ? r2.y : r2.top;
        return !(x1 + r1.width <= x2 + epsilon || x1 >= x2 + r2.width - epsilon || 
            y1 + r1.height <= y2 + epsilon || y1 >= y2 + r2.height - epsilon
        );
      })
    );  
}

const _fc = [...domCopy.querySelectorAll('*')].filter(el => {
  if (el.parentNode === domCopy) return false;
  const info = getNodeInfo(el);
  if (!info?.rect || info.style.position !== 'fixed') return false;
  const r = info.rect, cover = (r.width * r.height) / viewportArea;
  const cd = Math.abs((r.left + r.width/2) - window.innerWidth/2) / window.innerWidth;
  return cover > 0.15 && cover < 1.0 && cd < 0.3 && el.querySelector('button, input, a, [role="button"], iframe');
}).filter((el, _, arr) => !arr.some(o => o !== el && o.contains(el)))
  .sort((a, b) => (getNodeInfo(b).rect.width * getNodeInfo(b).rect.height) - (getNodeInfo(a).rect.width * getNodeInfo(a).rect.height))
  .slice(0, 2);
_fc.forEach(el => { el.parentNode.removeChild(el); domCopy.appendChild(el); });
analyzeNode(domCopy); 
domCopy.querySelectorAll('[data-mark^="R:"]').forEach(el=>el.parentNode?.removeChild(el));  
let root = domCopy;  
while (root.children.length === 1) {  
  root = root.children[0];  
}  
for (let ii = 0; ii < 3; ii++) {
  root.querySelectorAll('div').forEach(div => (!div.textContent.trim() && div.children.length === 0) && div.remove());
}
root.querySelectorAll('[data-mark]').forEach(e => e.removeAttribute('data-mark'));  
root.removeAttribute('data-mark');
root.querySelectorAll('iframe').forEach(f => {
  if (f.children.length) {
    const d = document.createElement('div');
    for (const a of f.attributes) d.setAttribute(a.name, a.value);
    d.setAttribute('data-tag', 'iframe');
    while (f.firstChild) d.appendChild(f.firstChild);
    f.parentNode.replaceChild(d, f);
  }
});
return root.outerHTML;
    }
optHTML()`;

export const jsFindMainList = String.raw`function findMainList(startElement = null) {
        const root = startElement || document.body;
        const MIN_CHILDREN = 8;
        const MAX_CONTAINERS = 20;
        const candidates = [];
        const allEls = root.querySelectorAll('*');
        for (const node of allEls) {
            if (node.closest('svg')) continue;
            const l1 = node.children.length;
            if (l1 < 5) continue;
            let l2 = 0;
            for (const child of node.children) l2 += child.children.length;
            const score = l1 + l2 * 0.1;
            if (score >= MIN_CHILDREN) candidates.push({node, score});
        }
        candidates.sort((a, b) => b.score - a.score);
        const toProcess = candidates.slice(0, MAX_CONTAINERS).map(c => c.node);
        let allCandidates = [];
        for (const container of toProcess) {
            const topGroups = findTopGroups(container, 3);
            for (const groupInfo of topGroups) {
                const items = findMatchingElements(container, groupInfo.selector);
                if (items.length >= 5) {
                    const score = scoreContainer(container, items) + groupInfo.score;
                    if (score >= 30) {
                        allCandidates.push({ container, selector: groupInfo.selector, items, score });
                    }
                }
            }
        }
        allCandidates.sort((a, b) => b.score - a.score);
        const kept = [];
        for (const cand of allCandidates) {
            let dominated = false;
            for (const k of kept) {
                if (k.container.contains(cand.container) || cand.container.contains(k.container)) {
                    const kSet = new Set(k.items);
                    const overlap = cand.items.filter(it => kSet.has(it)).length;
                    if (overlap > cand.items.length * 0.5) { dominated = true; break; }
                }
            }
            if (!dominated) kept.push(cand);
        }
        function describeResult(container, items, selector, score) {
            if(container&&!container.id)container.id='_ljq'+(window._lci=(window._lci||0)+1);
            const cTag = container ? container.tagName : null;
            const cId = container ? (container.id || '') : '';
            const cClass = container ? (String(container.className || '').trim()) : '';
            const result = {
                containerTag: cTag, containerId: cId, containerClass: cClass,
                itemCount: items.length,
            };
            let prefix = '';
            if (cId) prefix = '#' + CSS.escape(cId);
            if (selector) result.selector = prefix ? (prefix + ' > ' + selector) : selector;
            if (score !== undefined) result.score = score;
            if (items.length > 0) {
                result.firstItemPreview = items[0].outerHTML.substring(0, 200);
                result.itemTags = items.slice(0, 10).map(el => el.tagName + (el.className ? '.' + String(el.className).trim().split(/\s+/)[0] : ''));
            }
            return result;
        }
        if (kept.length === 0) return [];
        return kept.map(c => describeResult(c.container, c.items, c.selector, c.score));
    }
    function findTopGroups(container, limit) {
        const children = Array.from(container.children).filter(c => !c.closest('svg'));
        const totalChildren = children.length;
        if (totalChildren < 3) return [];
        const minGroupSize = Math.max(3, Math.floor(totalChildren * 0.2));
        const groups = [];
        const tagFreq = {}, classFreq = {}, tagMap = {}, classMap = {};
        children.forEach(child => {
            const tag = child.tagName.toLowerCase();
            if (tag === 'td') return;
            tagFreq[tag] = (tagFreq[tag] || 0) + 1;
            if (!tagMap[tag]) tagMap[tag] = [];
            tagMap[tag].push(child);
            if (child.className) {
                child.className.trim().split(/\s+/).forEach(cls => {
                    if (cls) {
                        classFreq[cls] = (classFreq[cls] || 0) + 1;
                        if (!classMap[cls]) classMap[cls] = [];
                        classMap[cls].push(child);
                    }
                });
            }
        });
        const scoreGroup = (selector, elements) => {
            const coverage = elements.length / totalChildren;
            let specificity = selector.startsWith('.') ? (0.6 + (selector.match(/\./g).length - 1) * 0.1) : (selector.includes('.') ? (0.7 + (selector.match(/\./g).length) * 0.1) : 0.3);
            return (coverage * 0.5) + (specificity * 0.5);
        };
        Object.keys(tagFreq).forEach(tag => {
            if (tag !== 'div' && tagFreq[tag] >= minGroupSize) {
                groups.push({ selector: tag, elements: tagMap[tag], score: scoreGroup(tag, tagMap[tag]) - 0.5 });
            }
        });
        Object.keys(classFreq).forEach(cls => {
            if (classFreq[cls] >= minGroupSize) {
                const selector = '.' + CSS.escape(cls);
                groups.push({ selector, elements: classMap[cls], score: scoreGroup(selector, classMap[cls]) });
            }
        });
        const topTags = Object.keys(tagFreq).filter(t => tagFreq[t] >= minGroupSize).slice(0, 3);
        const topClasses = Object.keys(classFreq).filter(c => classFreq[c] >= minGroupSize).sort((a, b) => classFreq[b] - classFreq[a]).slice(0, 3);
        topTags.forEach(tag => {
            topClasses.forEach(cls => {
                const elements = children.filter(el => el.tagName.toLowerCase() === tag && el.className && el.className.split(/\s+/).includes(cls));
                if (elements.length >= minGroupSize) {
                    const selector = tag + '.' + CSS.escape(cls);
                    groups.push({selector, elements, score: scoreGroup(selector, elements)});
                }
            });
        });
        for (let i = 0; i < topClasses.length; i++) {
            for (let j = i + 1; j < topClasses.length; j++) {
                const elements = children.filter(el => el.className && el.className.split(/\s+/).includes(topClasses[i]) && el.className.split(/\s+/).includes(topClasses[j]));
                if (elements.length >= minGroupSize) {
                    const selector = '.' + CSS.escape(topClasses[i]) + '.' + CSS.escape(topClasses[j]);
                    groups.push({selector, elements, score: scoreGroup(selector, elements)});
                }
            }
        }
        return groups.sort((a, b) => b.score - a.score).slice(0, limit);
    }
    function findMatchingElements(container, selector) {
        try {
            return Array.from(container.querySelectorAll(selector));
        } catch (e) {
            return [];
        }
    }
    function scoreContainer(container, items) {
        if (!container || items.length < 3) return 0;
        const containerRect = container.getBoundingClientRect();
        const containerArea = containerRect.width * containerRect.height;
        if (containerArea < 10000) return 0;
        const itemAreas = [];
        let totalItemArea = 0;
        let visibleItems = 0;
        items.forEach(item => {
            const rect = item.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > 0) {
                totalItemArea += area;
                itemAreas.push(area);
                visibleItems++;
            }
        });
        if (visibleItems < 3) return 0;
        totalItemArea = Math.min(totalItemArea, containerArea * 0.98);
        const areaRatio = totalItemArea / containerArea;
        const areaScore = 40 / (1 + Math.exp(-12 * (areaRatio - 0.4)));
        let uniformityScore = 0;
        if (itemAreas.length >= 3) {
            const mean = itemAreas.reduce((sum, area) => sum + area, 0) / itemAreas.length;
            const variance = itemAreas.reduce((sum, area) => sum + Math.pow(area - mean, 2), 0) / itemAreas.length;
            const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
            uniformityScore = 20 * Math.exp(-2.5 * cv);
        }
        const baseScore = Math.log2(visibleItems) * 5 + Math.floor(visibleItems / 5) * 0.25;
        const rawCountScore = Math.min(40, baseScore);
        const countScore = rawCountScore * Math.max(0.1, uniformityScore / 20);
        const viewportArea = window.innerWidth * window.innerHeight;
        const containerViewportRatio = containerArea / viewportArea;
        const sizeScore = 2 * (1 - 1/(1 + Math.exp(-10 * (containerViewportRatio - 0.25))));
        let layoutScore = 0;
        if (items.length >= 3) {
            const uniqueRows = new Set(items.map(item => Math.round(item.getBoundingClientRect().top / 5) * 5)).size;
            const uniqueCols = new Set(items.map(item => Math.round(item.getBoundingClientRect().left / 5) * 5)).size;
            if (uniqueRows === 1 || uniqueCols === 1) { layoutScore = 20;
            } else {
                const coverage = Math.min(1, items.length / (uniqueRows * uniqueCols));
                const efficiency = Math.max(0, 1 - (uniqueRows + uniqueCols) / (2 * items.length));
                layoutScore = 20 * (0.7 * coverage + 0.3 * efficiency);
            }
        }
        return countScore + areaScore + uniformityScore + layoutScore + sizeScore;
    }`;

const ALLOWED_ATTRS = new Set([
  'id', 'class', 'name', 'src', 'href', 'alt', 'value', 'type', 'placeholder',
  'disabled', 'checked', 'selected', 'readonly', 'required', 'multiple',
  'role', 'aria-label', 'aria-expanded', 'aria-hidden', 'contenteditable',
  'title', 'for', 'action', 'method', 'target', 'colspan', 'rowspan'
]);

function collapseTextForOutput(text: string): string {
  return text
    .replace(/ {2,}/g, ' ')
    .replace(/^ +/gm, '')
    .replace(/(\n\s*){3,}/g, '\n\n')
    .trim();
}

export function optimizeHtmlForTokens(html: string): string {
  const { document } = parseHTML(html);
  document.querySelectorAll('svg').forEach((svg) => {
    svg.textContent = '';
    for (const attr of Array.from(svg.attributes)) svg.removeAttribute(attr.name);
  });
  document.querySelectorAll('*').forEach((tag) => {
    tag.removeAttribute('style');
    const src = tag.getAttribute('src');
    if (src) {
      if (src.startsWith('data:')) tag.setAttribute('src', '__img__');
      else if (src.length > 30) tag.setAttribute('src', '__url__');
    }
    const href = tag.getAttribute('href');
    if (href && href.length > 30) tag.setAttribute('href', '__link__');
    const action = tag.getAttribute('action');
    if (action && action.length > 30) tag.setAttribute('action', '__url__');
    for (const a of ['value', 'title', 'alt']) {
      const v = tag.getAttribute(a);
      if (v && v.length > 100) tag.setAttribute(a, `${v.slice(0, 50)} ...`);
    }
    for (const attr of Array.from(tag.attributes)) {
      const name = attr.name;
      const value = attr.value;
      if (ALLOWED_ATTRS.has(name)) continue;
      if (name.startsWith('data-v')) {
        tag.removeAttribute(name);
      } else if (name.startsWith('data-') && value.length > 20) {
        tag.setAttribute(name, '__data__');
      } else if (!name.startsWith('data-')) {
        tag.removeAttribute(name);
      }
    }
  });
  return document.toString();
}

function getNodeSerializedLength(node: Element): number {
  return node.outerHTML.length;
}

function protectFakeElements(root: Element): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((tag) => {
    const text = tag.textContent || '';
    return text.includes('[FAKE ELEMENT]');
  });
}

function cutElementToBudget(document: Document, ele: Element, keep: number) {
  const s = ele.outerHTML;
  let over = s.length - keep;
  if (over <= 0) return;
  const protectedNodes = protectFakeElements(ele).map((node) => node.cloneNode(true) as Element);
  for (const child of Array.from(ele.children)) child.remove();
  ele.textContent = '';
  const marker = ` [TRUNCATED ${Math.floor(over / 1000)}k chars]`;
  const inner = (s.match(/^<[^>]+>([\s\S]*)<\/[^>]+>$/)?.[1]) ?? '';
  const tagOverhead = s.length - inner.length;
  const innerKeep = Math.max(keep - tagOverhead - marker.length, 0);
  if (innerKeep > 0) {
    const { document: fragDoc } = parseHTML(`<body>${inner.slice(0, innerKeep)}</body>`);
    for (const child of Array.from(fragDoc.body.childNodes)) {
      ele.appendChild(document.importNode ? document.importNode(child, true) : child.cloneNode(true));
    }
  }
  ele.appendChild(document.createTextNode(marker));
  for (const node of protectedNodes) ele.appendChild(node.cloneNode(true));
}

export function smartTruncateHtml(html: string, budget: number): string {
  const { document } = parseHTML(html);
  const body = document.body;
  smartTruncateElement(document, body, budget, 0);
  return body.innerHTML;
}

function smartTruncateElement(document: Document, root: Element, budget: number, depth: number) {
  const CUT_THRESHOLD = 8000;
  const total = root.outerHTML.length;
  if (total <= budget) return;
  const kids = Array.from(root.children)
    .filter((child) => !(child.textContent || '').includes('[FAKE ELEMENT]'))
    .map((child) => ({ node: child, len: getNodeSerializedLength(child) }));
  if (kids.length === 0) return;
  const selflen = total - kids.reduce((sum, item) => sum + item.len, 0);
  const remainingBudget = Math.max(budget - selflen, 0);
  if (kids.length === 1) {
    smartTruncateElement(document, kids[0].node, remainingBudget, depth + 1);
    return;
  }
  const over = kids.reduce((sum, item) => sum + item.len, 0) - remainingBudget;
  if (over <= 0) return;
  const ranked = kids.map((_, i) => i).sort((a, b) => kids[b].len - kids[a].len);
  let tops = ranked.slice(0, Math.min(3, ranked.length));
  let topTotal = tops.reduce((sum, i) => sum + kids[i].len, 0);
  if (topTotal < over) {
    let removed = 0;
    while (kids.length && removed < over) {
      const item = kids.pop();
      if (!item) break;
      item.node.remove();
      removed += item.len;
    }
    return;
  }
  const maxSize = kids[ranked[0]].len;
  const filtered = tops.filter((i) => kids[i].len >= maxSize * 0.1);
  const filteredTotal = filtered.reduce((sum, i) => sum + kids[i].len, 0);
  if (filteredTotal >= over) {
    tops = filtered;
    topTotal = filteredTotal;
  }
  for (const i of tops) {
    const item = kids[i];
    const share = Math.floor((over * item.len) / topTotal);
    const newKeep = item.len - share;
    if (newKeep <= 0) item.node.remove();
    else if (newKeep > CUT_THRESHOLD) smartTruncateElement(document, item.node, newKeep, depth + 1);
    else cutElementToBudget(document, item.node, newKeep);
  }
}

export interface ScanPageOptions {
  textOnly?: boolean;
  cutlist?: boolean;
  maxchars?: number;
  instruction?: string;
  extraJs?: string;
}

export function buildOptHtmlScript(options: Pick<ScanPageOptions, 'textOnly' | 'extraJs'>): string {
  const textOnly = options.textOnly ? 'true' : 'false';
  const extraJs = options.extraJs?.trim() ? `${options.extraJs}\n` : '';
  return `${extraJs}${jsOptHtml}\nreturn optHTML(${textOnly});`;
}

export function buildFindMainListScript(): string {
  return `${jsFindMainList}\nreturn findMainList(document.body);`;
}

export function postProcessScannedHtml(rawHtml: string, options: ScanPageOptions): string {
  const maxchars = options.maxchars ?? 35000;
  const optimized = optimizeHtmlForTokens(rawHtml);
  const { document } = parseHTML(optimized);
  document.querySelectorAll('div[data-tag="iframe"]').forEach((div) => {
    const iframe = document.createElement('iframe');
    for (const attr of Array.from(div.attributes)) {
      if (attr.name === 'data-tag') continue;
      iframe.setAttribute(attr.name, attr.value);
    }
    while (div.firstChild) iframe.appendChild(div.firstChild);
    div.replaceWith(iframe);
  });
  let html = document.toString();
  if (html.length > maxchars) {
    html = smartTruncateHtml(html, maxchars);
  }
  return html;
}

export function applyCutList(html: string, rawLists: unknown, instruction: string | undefined, maxchars: number): string {
  const { document } = parseHTML(html);
  const lists = Array.isArray(rawLists)
    ? rawLists
    : rawLists && typeof rawLists === 'object' && 'selector' in (rawLists as Record<string, unknown>)
      ? [rawLists]
      : [];
  for (const entry of lists) {
    const selector = typeof (entry as any)?.selector === 'string' ? (entry as any).selector : undefined;
    if (!selector) continue;
    let items: Element[] = [];
    try {
      items = Array.from(document.querySelectorAll(selector));
    } catch {
      continue;
    }
    if (items.length < 5) continue;
    const totalLen = items.reduce((sum, item) => sum + item.outerHTML.length, 0);
    const avgLen = totalLen / items.length;
    if (avgLen < 200 || (avgLen < 700 && totalLen < 2500)) continue;
    const hit = items.filter((item) => instruction && instruction.trim() && (item.textContent || '').includes(instruction));
    const keep = hit.length > 0 ? hit.slice(0, 6) : items.slice(0, 3);
    const removed = items.filter((item) => !keep.includes(item));
    const sampleTexts: string[] = [];
    for (const rm of removed.slice(0, 5)) {
      const txt = (rm.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (txt) sampleTexts.push(txt);
    }
    const hint = document.createElement('div');
    const parts = [`[FAKE ELEMENT] ${removed.length} more items hidden, selector: "${selector}"`];
    if (sampleTexts.length > 0) parts.push(`Hidden items: ${sampleTexts.map((t) => `"${t}"`).join(',')}`);
    hint.textContent = parts.join(' ');
    const lastKeep = keep.at(-1);
    if (lastKeep?.parentNode) lastKeep.after(hint);
    for (const item of removed) item.remove();
  }
  let out = optimizeHtmlForTokens(document.toString());
  if (out.length > maxchars) out = smartTruncateHtml(out, maxchars);
  return out;
}

export function normalizeTextOnlyOutput(text: string): string {
  return collapseTextForOutput(text);
}

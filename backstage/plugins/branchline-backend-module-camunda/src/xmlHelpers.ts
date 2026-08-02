// Shared BPMN XML DOM-walking helpers used by both BpmnAdapter (flow-graph
// building) and BpmnParser (task-hierarchy building).

export function attr(el: Element, name: string): string {
  return el.getAttribute(name) ?? '';
}

export function childElements(el: Element): Element[] {
  const result: Element[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes.item(i);
    if (node.nodeType === 1) result.push(node as Element);
  }
  return result;
}

export function getDocumentation(el: Element): string | undefined {
  for (const child of childElements(el)) {
    if (child.localName === 'documentation') {
      return child.textContent?.trim() || undefined;
    }
  }
  return undefined;
}

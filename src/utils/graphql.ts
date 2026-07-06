type GraphqlOperationType = 'query' | 'mutation' | 'subscription' | 'unknown';

interface GraphqlOperationDefinition {
  type: GraphqlOperationType;
  name?: string;
}

function stripGraphqlIgnored(value: string): string {
  return value
    .replace(/"""[\s\S]*?"""/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/#[^\n\r]*/g, ' ');
}

export function graphqlOperationDefinitions(query: string | undefined): GraphqlOperationDefinition[] {
  if (!query) return [];
  const stripped = stripGraphqlIgnored(query);
  const definitions: GraphqlOperationDefinition[] = [];
  const pattern = /\b(query|mutation|subscription)\b\s*([_A-Za-z][_0-9A-Za-z]*)?/gi;
  for (const match of stripped.matchAll(pattern)) {
    definitions.push({
      type: match[1].toLowerCase() as GraphqlOperationType,
      name: match[2]
    });
  }
  if (definitions.length === 0 && /^\s*\{/.test(stripped)) {
    definitions.push({ type: 'query' });
  }
  return definitions;
}

export function graphqlOperationType(query: string | undefined, operationName?: string): GraphqlOperationType {
  const definitions = graphqlOperationDefinitions(query);
  if (definitions.length === 0) return 'unknown';
  if (operationName) {
    return definitions.find((definition) => definition.name === operationName)?.type ?? 'unknown';
  }
  const unique = [...new Set(definitions.map((definition) => definition.type))];
  return unique.length === 1 ? unique[0] : 'unknown';
}

export function isReadOnlyGraphqlOperation(query: string | undefined, operationName?: string): boolean {
  const definitions = graphqlOperationDefinitions(query);
  if (definitions.length === 0) return false;
  if (operationName) {
    const matched = definitions.find((definition) => definition.name === operationName);
    return Boolean(matched && (matched.type === 'query' || matched.type === 'subscription'));
  }
  return definitions.every((definition) => definition.type === 'query' || definition.type === 'subscription');
}


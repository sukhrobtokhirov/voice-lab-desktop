export interface ToolResult {
  success: boolean;
  data: unknown;
  displayText: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface SerializableTool {
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: unknown) => Promise<unknown>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  toAISDKFormat(): Record<string, SerializableTool> {
    const result: Record<string, SerializableTool> = {};
    for (const def of this.getAll()) {
      result[def.name] = {
        description: def.description,
        inputSchema: def.parameters,
        execute: async (args: unknown) => {
          try {
            const toolResult = await def.execute(args as Record<string, unknown>);
            return toolResult.success ? toolResult.data : { error: toolResult.displayText };
          } catch (error) {
            return { error: (error as Error).message || "Tool execution failed" };
          }
        },
      };
    }
    return result;
  }
}

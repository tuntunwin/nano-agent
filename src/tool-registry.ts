import type { ToolDefinition, ToolParameter } from "./types.js";

/**
 * JSON Schema representation of a tool, compatible with OpenAI function calling format.
 */
export interface ToolJsonSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
}

/**
 * Registry for tool definitions. Handles registration, lookup, schema
 * rendering, and argument validation.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (!/^[a-zA-Z_]\w*$/.test(tool.name)) {
      throw new Error(
        `Invalid tool name "${tool.name}": must be alphanumeric + underscores, starting with a letter or underscore.`,
      );
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get size(): number {
    return this.tools.size;
  }

  /**
   * Convert a single tool definition to OpenAI-compatible JSON Schema.
   */
  static toJsonSchema(tool: ToolDefinition): ToolJsonSchema {
    const properties: ToolJsonSchema["parameters"]["properties"] = {};
    const required: string[] = [];

    for (const param of tool.parameters) {
      const prop: { type: string; description: string; enum?: string[] } = {
        type: param.type,
        description: param.description,
      };
      if (param.enum && param.enum.length > 0) {
        prop.enum = param.enum;
      }
      properties[param.name] = prop;
      if (param.required) {
        required.push(param.name);
      }
    }

    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties,
        required,
      },
    };
  }

  /**
   * Render all registered tools as an array of OpenAI-compatible JSON Schemas.
   */
  toJsonSchemaAll(): ToolJsonSchema[] {
    return this.getAll().map(ToolRegistry.toJsonSchema);
  }

  /**
   * Validate and coerce raw parsed arguments against a tool's parameter schema.
   * Returns coerced args or throws with a descriptive message.
   */
  validateArgs(
    toolName: string,
    rawArgs: Record<string, unknown>,
  ): Record<string, string | number | boolean> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      throw new Error(`Unknown tool: "${toolName}"`);
    }

    const result: Record<string, string | number | boolean> = {};

    for (const param of tool.parameters) {
      const value = rawArgs[param.name];

      if (value === undefined || value === null) {
        if (param.required) {
          throw new Error(
            `Missing required parameter "${param.name}" for tool "${toolName}"`,
          );
        }
        continue;
      }

      result[param.name] = coerceParam(param, value);
    }

    return result;
  }
}

function coerceParam(param: ToolParameter, value: unknown): string | number | boolean {
  switch (param.type) {
    case "string": {
      const str = String(value);
      if (param.enum && param.enum.length > 0 && !param.enum.includes(str)) {
        throw new Error(
          `Parameter "${param.name}" must be one of: ${param.enum.join(", ")}. Got "${str}"`,
        );
      }
      return str;
    }
    case "number": {
      const num =
        typeof value === "number" ? value : Number(value);
      if (isNaN(num)) {
        throw new Error(
          `Parameter "${param.name}" must be a number. Got "${String(value)}"`,
        );
      }
      return num;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw new Error(
        `Parameter "${param.name}" must be a boolean. Got "${String(value)}"`,
      );
    }
    default:
      return String(value);
  }
}

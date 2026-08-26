function parse(schema, value, code = "IPC_PAYLOAD_INVALID") {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const error = new Error("Invalid IPC payload");
  error.code = code;
  error.details = result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
  throw error;
}

module.exports = { parse };

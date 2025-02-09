export function handleFunctionCall(name, args) {
  console.log(`[DummyFunction] Called ${name} with`, args);
  // all just return { result: "hi" }
  return { result: "hi" };
}

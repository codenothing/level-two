jest.setTimeout(500);

afterEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

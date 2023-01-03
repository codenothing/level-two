jest.setTimeout(10000);

afterEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

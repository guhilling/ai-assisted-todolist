// The safe-area module is native; its own mock reports a phone without notches or bars.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)

import { useColorScheme } from 'react-native';

const light = {
  background: '#FAF9F6',
  surface: '#FFFFFF',
  text: '#22201D',
  muted: '#74706A',
  border: '#E5E1DA',
  accent: '#C44426',
  user: '#F8E9DF',
  error: '#B42318',
};
const dark = {
  background: '#171715',
  surface: '#242421',
  text: '#F4F1EA',
  muted: '#ABA79E',
  border: '#393933',
  accent: '#FF997B',
  user: '#3B2B23',
  error: '#FF938A',
};

export function useTheme() {
  return useColorScheme() === 'dark' ? dark : light;
}

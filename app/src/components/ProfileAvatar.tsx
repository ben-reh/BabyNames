import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity } from 'react-native';
import { colors } from '../constants/theme';

const SIZE = 32;

export function ProfileAvatar() {
  return (
    <TouchableOpacity activeOpacity={0.7}>
      <Ionicons name="person-circle-outline" size={SIZE} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

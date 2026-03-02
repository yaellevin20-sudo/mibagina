import { View } from 'react-native';

type Props = {
  steps: number;
  current: number; // 1-indexed
};

export default function OnboardingProgress({ steps, current }: Props) {
  return (
    <View className="flex-row gap-2 mb-8" style={{ gap: 6 }}>
      {Array.from({ length: steps }, (_, i) => (
        <View
          key={i}
          className={i < current ? 'bg-brand-green' : 'bg-brand-green-soft'}
          style={{ flex: 1, height: 4, borderRadius: 2 }}
        />
      ))}
    </View>
  );
}

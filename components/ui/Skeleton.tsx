import { View } from 'react-native';
import { Card } from './Card';

// Static, not shimmering — this app has no animation anywhere yet, and the
// design brief is explicit about not introducing motion complexity for its
// own sake. A well-shaped static placeholder still reads as "content is
// coming," which is the actual job of a skeleton — a bare spinner tells you
// nothing about what's about to appear.
function Bone({ width, height = 12, className }: { width: number | `${number}%`; height?: number; className?: string }) {
  return <View className={`rounded-md bg-neutral-100 ${className ?? ''}`} style={{ width, height }} />;
}

export function AlertCardSkeleton() {
  return (
    <Card accentColor="#E5E7EB" className="mb-3">
      <Bone width="70%" height={16} />
      <Bone width="45%" height={12} className="mt-2" />
      <View className="flex-row justify-between mt-3">
        <Bone width={90} height={12} />
      </View>
      <View className="flex-row gap-2 mt-4">
        <Bone width="100%" height={36} className="flex-1" />
        <Bone width="100%" height={36} className="flex-1" />
        <Bone width="100%" height={36} className="flex-1" />
      </View>
    </Card>
  );
}

export function AlertRowSkeleton() {
  return (
    <Card accentColor="#E5E7EB" className="mb-2">
      <View className="flex-row justify-between">
        <Bone width="60%" height={14} />
        <Bone width={50} height={16} />
      </View>
      <Bone width="40%" height={11} className="mt-2" />
      <Bone width="55%" height={11} className="mt-1.5" />
    </Card>
  );
}

export function ProgressCardSkeleton() {
  return (
    <Card className="mb-6">
      <Bone width="35%" height={11} />
      <Bone width="45%" height={26} className="mt-2" />
      <Bone width="100%" height={8} className="mt-4 rounded-full" />
    </Card>
  );
}

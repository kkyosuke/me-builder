import {
  BookOpen,
  Calculator,
  CircleCheck,
  CircleX,
  Clock,
  Coffee,
  Heart,
  House,
  Leaf,
  type LucideIcon,
  Moon,
  Mountain,
  Music,
  Sun,
  User,
  Users,
  Zap,
} from "lucide-react";
import type { SurveyIconName } from "../survey/types";

/**
 * アイコン名から lucide-react のコンポーネントへの対応。
 *
 * 質問データにはコンポーネントを持たせず名前だけを持たせているため、対応表は表示層に置きます。
 * アイコンは lucide-react だけを使います。
 */
const ICONS: Record<SurveyIconName, LucideIcon> = {
  house: House,
  mountain: Mountain,
  book: BookOpen,
  zap: Zap,
  user: User,
  users: Users,
  sun: Sun,
  moon: Moon,
  leaf: Leaf,
  music: Music,
  heart: Heart,
  calculator: Calculator,
  coffee: Coffee,
  clock: Clock,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
};

export function SurveyIcon({
  name,
  className,
}: {
  name: SurveyIconName;
  className?: string;
}) {
  const Icon = ICONS[name];
  // アイコンは装飾なので、読み上げの対象から外します（隣にラベルの文字があります）。
  return <Icon className={className} aria-hidden="true" />;
}

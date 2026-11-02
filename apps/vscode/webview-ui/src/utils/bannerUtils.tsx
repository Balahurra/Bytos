import { BannerAction, BannerCardData } from "@shared/bytos/banner"
import {
	BadgePercent,
	Bell,
	Bug,
	Calendar,
	CircleDollarSign,
	Clock,
	Cloud,
	Download,
	ExternalLink,
	Gift,
	Globe,
	Heart,
	Info,
	Lightbulb,
	Megaphone,
	MessageCircle,
	PartyPopper,
	Pin,
	Rocket,
	Search,
	Settings,
	ShieldCheck,
	Sparkles,
	Star,
	Tags,
	Users,
	Wrench,
	Zap,
	type LucideIcon,
} from "lucide-react"
import { BannerData } from "@/components/common/BannerCarousel"

/**
 * Banner icons arrive as names from remote config. Resolve them against a small
 * static set instead of lucide's `dynamicIconImports`, which creates a separate
 * webview chunk for every icon in the library (1,000+ files).
 */
const BANNER_ICONS: Record<string, LucideIcon> = {
	badgepercent: BadgePercent,
	bell: Bell,
	bug: Bug,
	calendar: Calendar,
	circledollarsign: CircleDollarSign,
	clock: Clock,
	cloud: Cloud,
	download: Download,
	externallink: ExternalLink,
	gift: Gift,
	globe: Globe,
	heart: Heart,
	info: Info,
	lightbulb: Lightbulb,
	megaphone: Megaphone,
	messagecircle: MessageCircle,
	partypopper: PartyPopper,
	pin: Pin,
	rocket: Rocket,
	search: Search,
	settings: Settings,
	shieldcheck: ShieldCheck,
	sparkles: Sparkles,
	star: Star,
	tags: Tags,
	users: Users,
	wrench: Wrench,
	zap: Zap,
}

function getBannerIcon(name: string | undefined): LucideIcon {
	if (!name) {
		return Sparkles
	}
	const key = name.toLowerCase().replace(/[^a-z0-9]/g, "")
	return BANNER_ICONS[key] ?? Sparkles
}

/**
 * Convert BannerCardData to BannerData for rendering
 */
export function convertBannerData(
	banner: BannerCardData,
	handlers: {
		onAction: (action: BannerAction) => void
		onDismiss: (bannerId: string) => void
	},
): BannerData {
	const { onAction, onDismiss } = handlers

	// Filter and process actions
	const filteredActions =
		banner.actions?.map((action) => ({
			label: action.title,
			onClick: () => onAction(action),
		})) || []

	const Icon = banner.icon ? getBannerIcon(banner.icon) : undefined

	return {
		id: banner.id,
		icon: Icon ? <Icon className="size-4" /> : undefined,
		title: banner.title,
		description: banner.description,
		actions: filteredActions.length > 0 ? filteredActions : undefined,
		onDismiss: () => onDismiss(banner.id),
	}
}

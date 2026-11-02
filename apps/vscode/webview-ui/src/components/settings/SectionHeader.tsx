import { cn } from "@heroui/theme"
import { HTMLAttributes } from "react"

type SectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
	children: React.ReactNode
	description?: string
}

const SectionHeader = ({ description, children, className, ...props }: SectionHeaderProps) => {
	return (
		<div className={cn("bytos-section-header text-foreground", className)} {...props}>
			<h2 className="m-0 text-base">{children}</h2>
			{description && <p className="text-description text-sm mt-2 mb-0">{description}</p>}
		</div>
	)
}

export default SectionHeader

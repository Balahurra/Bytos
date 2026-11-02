import { HTMLAttributes } from "react"

type SectionProps = HTMLAttributes<HTMLDivElement>

const Section = ({ className, ...props }: SectionProps) => (
	<div className={`bytos-settings-panel my-2 flex flex-col gap-3 ${className || ""}`} {...props} />
)

export default Section

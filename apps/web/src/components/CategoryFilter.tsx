import type { EventCategory } from '../types/event'

const categories: EventCategory[] = [
  'Technology',
  'Cultural',
  'Sports',
  'Workshops',
  'Hackathons',
]

interface CategoryFilterProps {
  selectedCategory: EventCategory | 'All'
  onSelectCategory: (category: EventCategory | 'All') => void
}

export function CategoryFilter({
  selectedCategory,
  onSelectCategory,
}: CategoryFilterProps) {
  return (
    <div className="category-filters" aria-label="Filter events by category">
      {(['All', ...categories] as const).map((category) => (
        <button
          className={`filter-chip${selectedCategory === category ? ' is-selected' : ''}`}
          key={category}
          type="button"
          aria-pressed={selectedCategory === category}
          onClick={() => onSelectCategory(category)}
        >
          {category}
        </button>
      ))}
    </div>
  )
}

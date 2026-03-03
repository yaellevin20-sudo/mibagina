# mi bagina — Design System Reference

> **Read this before generating any UI.** This file is the single source of truth for visual style. Do not invent colors, fonts, or component shapes — use exactly what is defined here.

---

## Colors

### Brand palette (tailwind.config.js)
| Token | Hex | Tailwind class | Usage |
|---|---|---|---|
| `brand.green` | `#3D7A50` | `bg-brand-green` / `text-brand-green` | Primary buttons, accents, icons |
| `brand.green-soft` | `#E4F2EA` | `bg-brand-green-soft` | Soft tints |
| `brand.green-dark` | `#2A5538` | `text-brand-green-dark` | Auth screen headings |

### Semantic colors (use these exactly — do not substitute Tailwind green-* utilities)
| Purpose | Hex | Notes |
|---|---|---|
| Primary action | `#3D7A50` | All primary buttons, active states, icons |
| Page bg (tabs) | `#F1FDF5` | Children tab, groups tab screen bg |
| Page bg (home) | `#F9FAFB` | `bg-gray-50` |
| Auth gradient | `['#FFFFFF', '#F1FDF5']` | `LinearGradient` on all auth screens |
| Input bg | `#F7FAF8` | TextInput background |
| Input label | `#4A5C4E` | Label text above inputs |
| Card border | `#D9D9D9` | Child cards |
| Card border subtle | `#E5E7EB` | `border-gray-200` / `border-gray-100` |
| Info banner bg | `#F1FDF5` | Notification and setup banners |
| Orange accent | `#E07B30` | Active session card top border only |
| Destructive | `#EF4444` | `text-red-500`, `border-red-200` |

### ⚠️ Color anti-patterns (do not use)
- `#16a34a` (`green-600`) — wrong brand color, do not use anywhere
- `#008234` — wrong link color, use `#3D7A50` instead
- `bg-green-*`, `text-green-*` Tailwind utilities — use `brand-green` tokens or hex values

---

## Typography

Font family: **Rubik** (loaded via expo-google-fonts). Always apply via NativeWind class, never via `fontFamily` style prop.

| Weight | Class | Use case |
|---|---|---|
| 400 Regular | `font-rubik` | Body text, secondary labels, descriptions |
| 500 Medium | `font-rubik-medium` | Child/person names in cards |
| 600 SemiBold | `font-rubik-semi` | Tab headers, section titles, app name |
| 700 Bold | `font-rubik-bold` | Screen headings, primary button labels |

### Text size scale
| Use case | Class |
|---|---|
| Input labels | `text-xs font-rubik-semi` |
| Small buttons, chips | `text-sm font-rubik-medium` |
| Body, card content | `text-sm font-rubik` or `text-base font-rubik` |
| Card titles | `text-base font-rubik-bold` or `text-lg font-rubik-medium` |
| Screen subtitle | `text-xl font-rubik-bold` |
| Screen title | `text-2xl font-rubik-semi` or `text-3xl font-rubik-semi` |
| Auth heading | `font-rubik-bold`, `fontSize: 30` via style |
| Landing hero | `text-4xl font-rubik-bold` |

---

## Shadows

### BTN_SHADOW — apply to all filled primary buttons
```js
const BTN_SHADOW = {
  shadowColor: '#3D7A50',
  shadowOffset: { width: 0, height: 3 },
  shadowOpacity: 0.28,
  shadowRadius: 7,
  elevation: 6,
};
```

### FAB_SHADOW — floating action button
```js
shadowColor: '#000',
shadowOffset: { width: 0, height: 4 },
shadowOpacity: 0.3,
shadowRadius: 8,
elevation: 8,
```

---

## Component Patterns

### Primary button (full-width)
```tsx
<TouchableOpacity
  className="w-full rounded-xl py-4 items-center"
  style={{ backgroundColor: '#3D7A50', ...BTN_SHADOW }}
  onPress={...}
>
  <Text className="text-white font-rubik-bold text-base">{label}</Text>
</TouchableOpacity>
```

### Secondary button (outline, full-width)
```tsx
<TouchableOpacity
  className="w-full rounded-xl py-4 items-center border"
  style={{ borderColor: '#3D7A50' }}
  onPress={...}
>
  <Text className="font-rubik-bold text-base" style={{ color: '#3D7A50' }}>{label}</Text>
</TouchableOpacity>
```

### Small pill chip (group selector, tags)
```tsx
<TouchableOpacity
  className={`px-3 py-1.5 rounded-full border ${
    active ? 'bg-brand-green border-brand-green' : 'border-gray-300 bg-white'
  }`}
>
  <Text className={`text-sm font-rubik-medium ${active ? 'text-white' : 'text-gray-700'}`}>
    {label}
  </Text>
</TouchableOpacity>
```

### Small action button (inline, e.g. "Still here" / "Leaving")
```tsx
<TouchableOpacity className="border border-green-500 rounded-lg px-2 py-1">
  <Text className="text-xs" style={{ color: '#3D7A50' }}>{label}</Text>
</TouchableOpacity>
```

### Destructive action button (inline remove)
```tsx
<TouchableOpacity className="border border-red-200 rounded-lg py-2 items-center">
  <Text className="text-red-500 text-sm font-rubik">{label}</Text>
</TouchableOpacity>
```

### Text input
```tsx
const INPUT_STYLE = {
  backgroundColor: '#F7FAF8',
  borderWidth: 1.5,
  borderColor: 'rgba(0,0,0,0.10)',
  borderRadius: 10,
};

// Label
<Text className="text-xs font-rubik-semi mb-1.5" style={{ color: '#4A5C4E' }}>
  {label}
</Text>
// Input
<TextInput
  className="rounded-xl px-4 py-3 mb-4 text-base font-rubik"
  style={INPUT_STYLE}
  ...
/>
```

### Standard card (playground / feed item)
```tsx
<TouchableOpacity
  className="bg-white rounded-xl mx-4 mb-3 p-4 shadow-sm border border-gray-100"
  activeOpacity={0.8}
>
  {/* content */}
</TouchableOpacity>
```

### Child card (slightly heavier border)
```tsx
<View
  className="bg-white mx-4 mb-3 px-4 py-5"
  style={{ borderWidth: 1, borderColor: '#d9d9d9', borderRadius: 10 }}
>
  {/* content */}
</View>
```

### Info / notification banner card
```tsx
<View
  style={{
    marginHorizontal: 14,
    marginTop: 12,
    backgroundColor: '#F1FDF5',
    borderWidth: 1,
    borderColor: '#afafaf',
    borderRadius: 10,
    overflow: 'hidden',
  }}
>
  {/* content rows + divider */}
  <View style={{ height: 1, backgroundColor: '#afafaf' }} />
  {/* action row */}
</View>
```

### Active session card (orange top accent)
```tsx
<View
  className="mx-4 mb-3 bg-white rounded-xl overflow-hidden"
  style={{ borderWidth: 1, borderColor: '#e5ddd5', borderTopWidth: 3, borderTopColor: '#E07B30' }}
>
  <View className="p-4">{/* content */}</View>
</View>
```

### FAB (floating action button)
```tsx
<TouchableOpacity
  style={{
    position: 'absolute',
    bottom: 80,
    left: 20,  // start in RTL — adjust per screen
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    ...FAB_SHADOW,
  }}
>
  <Ionicons name="home-outline" size={24} color="#3D7A50" />
</TouchableOpacity>
```

### Section divider
```tsx
<View className="flex-row items-center mb-4">
  <View className="flex-1 h-px bg-gray-200" />
  <Text className="mx-3 text-gray-400 text-sm font-rubik">{t('common.or')}</Text>
  <View className="flex-1 h-px bg-gray-200" />
</View>
```

---

## Screen-level Patterns

### Auth screens (login, signup, name)
- **Wrapper**: `LinearGradient colors={['#FFFFFF', '#F1FDF5']}` → `SafeAreaView` → `KeyboardAvoidingView className="flex-1 px-6"`
- **Heading**: `font-rubik-bold text-brand-green-dark`, `fontSize: 30`
- **Primary action first** (Google OAuth or main CTA), then email/password form

### Tab screens (children, groups, profile)
- **Wrapper**: `SafeAreaView style={{ flex: 1, backgroundColor: '#f1fdf5' }}`
- **App bar**: same bg as screen, `px-6 py-3 flex-row justify-between items-center`
  - Leading: tree icon (`assets/tree.png` 26×26) + app name `text-2xl font-rubik-semi text-black`
  - Trailing: `Ionicons name="menu"` hamburger
- **Screen title**: `px-6 pt-5 pb-3`, `text-3xl font-rubik-semi text-black`

### Home screen
- **Wrapper**: `SafeAreaView className="flex-1 bg-gray-50"`
- **Header**: `px-4 py-4 bg-white border-b border-gray-200`, title left + CTA button right
- **Content**: 12px vertical padding, `mx-4` horizontal card margins

---

## Icons

Package: `@expo/vector-icons`

| Set | When to use |
|---|---|
| `Ionicons` | Navigation, actions, UI icons (primary set) |
| `AntDesign` | Third-party brand icons (e.g. Google logo) |

Common Ionicons: `home-outline`, `people-outline`, `chatbubbles-outline`, `person-outline`, `menu`, `chevron-back`, `close`, `add`, `checkmark`

---

## Assets

Stored in `assets/` at project root:
| File | Used for |
|---|---|
| `tree.png` | App icon / app bar logo |
| `playground.png` | Home empty state illustration |
| `kite.png` | Children tab empty state |
| `message.png` | Notification banner icon |

Import pattern: `require('../../assets/tree.png')` (adjust depth as needed)

---

## Layout & RTL

- App is **RTL by default** (Hebrew). Use `start`/`end` instead of `left`/`right` in logical properties.
- Standard horizontal padding: `px-4` (cards) or `px-6` (screen content)
- Standard card gap: `mb-3`
- `SafeAreaView` wraps every screen root — never use raw `View` at screen level

---

## Loading States

```tsx
<ActivityIndicator size="large" color="#3D7A50" />
// always use brand color — never #16a34a or 'green'
```

---

## i18n

- All user-visible strings via `const { t } = useTranslation()` — never hardcode Hebrew or English text.
- Translation keys live in `locales/he.json` and `locales/en.json`.

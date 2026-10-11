import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View,
  type StyleProp, type TextInputProps, type TextStyle, type ViewStyle
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { router } from 'expo-router';
import { addDays, globalStreak, ymd } from '@pepsgoal/shared';
import { store } from '../db/local';
import { subscribeSync } from '../sync/engine';
import { useNetwork } from '../state/network';
import { useSession } from '../state/session';
import { ICONS, type IconName } from './icons';
import { ACCENTS, alpha, FONT, TYPE_ICON, TYPE_LABEL, useTheme, type Theme } from './theme';

/* =====================================================================================
 * Kit d'interface PepsGoal : reprend les composants de l'app web (apps/web-legacy/pepsgoal.html)
 * — panneaux vitrés, boutons en dégradé d'accent, puces de type, flammes, anneau de progression.
 * ===================================================================================== */

export const WIDE = 860;
export const useWide = () => useWindowDimensions().width >= WIDE;
const isWeb = Platform.OS === 'web';
/** Flou d'arrière-plan des panneaux vitrés (navigateur uniquement ; sur mobile, les panneaux sont presque opaques). */
const blur = (t: Theme, px = 16): ViewStyle => (isWeb && t.blobOpacity > 0 ? ({ backdropFilter: `blur(${px}px) saturate(160%)`, WebkitBackdropFilter: `blur(${px}px) saturate(160%)` } as unknown as ViewStyle) : {});
const shadow = (t: Theme, strong = false): ViewStyle => t.highContrast ? {} : ({ shadowColor: t.dark ? '#000' : '#28186E', shadowOpacity: t.dark ? 0.55 : 0.22, shadowRadius: strong ? 30 : 22, shadowOffset: { width: 0, height: strong ? 18 : 12 }, elevation: strong ? 8 : 4 });

/* ---------- texte ---------- */
type Variant = 'body' | 'bold' | 'muted' | 'small' | 'eyebrow' | 'hello' | 'h1' | 'h2' | 'title' | 'num' | 'label';
export function Txt({ v = 'body', color, style, children, ...rest }: { v?: Variant; color?: string; style?: StyleProp<TextStyle>; children: ReactNode } & Omit<React.ComponentProps<typeof Text>, 'style' | 'children'>) {
  const t = useTheme();
  const base: Record<Variant, TextStyle> = {
    body: { fontFamily: FONT.body, fontSize: 15, lineHeight: 22, color: t.ink },
    bold: { fontFamily: FONT.heavy, fontSize: 15, color: t.ink },
    muted: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 22, color: t.ink2 },
    small: { fontFamily: FONT.semibold, fontSize: 13, lineHeight: 18, color: t.ink2 },
    label: { fontFamily: FONT.heavy, fontSize: 13, color: t.ink2 },
    eyebrow: { fontFamily: FONT.heavy, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: t.ink2 },
    hello: { fontFamily: FONT.display, fontSize: 34, lineHeight: 38, letterSpacing: -1, color: t.ink },
    h1: { fontFamily: FONT.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.6, color: t.ink },
    h2: { fontFamily: FONT.displayBold, fontSize: 17, letterSpacing: -0.2, color: t.ink },
    title: { fontFamily: FONT.displayBold, fontSize: 18, color: t.ink },
    num: { fontFamily: FONT.display, fontSize: 22, color: t.ink }
  };
  return <Text {...rest} style={[base[v], color ? { color } : null, style]}>{children}</Text>;
}
/** Compatibilité : titres et textes secondaires des écrans existants. */
export const Title = ({ children }: { children: ReactNode }) => <Txt v="h1" accessibilityRole="header">{children}</Txt>;
export const Muted = ({ children }: { children: ReactNode }) => <Txt v="small">{children}</Txt>;

/* ---------- pictogrammes, flamme ---------- */
/** Tracés d'un pictogramme (path, circle, rect), convertis une fois en éléments SVG natifs (iOS, Android, web). */
const SHAPES = new Map<string, { tag: string; a: Record<string, string> }[]>();
function shapes(name: string) {
  let out = SHAPES.get(name);
  if (!out) {
    const body: string = ICONS[name as IconName] ?? ICONS.star;
    out = [...body.matchAll(/<(path|circle|rect)\s([^>]*?)\/?>/g)].map(m => ({ tag: m[1]!, a: Object.fromEntries([...m[2]!.matchAll(/([a-z]+)="([^"]*)"/g)].map(x => [x[1]!, x[2]!])) }));
    SHAPES.set(name, out);
  }
  return out;
}
export function Icon({ name, size = 20, color, stroke = 2 }: { name: IconName | string; size?: number; color?: string; stroke?: number }) {
  const t = useTheme();
  const c = color ?? t.ink;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shapes(name).map(({ tag, a }, i) => tag === 'path' ? <Path key={i} d={a.d} />
        : tag === 'circle' ? <Circle key={i} cx={a.cx} cy={a.cy} r={a.r} />
        : <Rect key={i} x={a.x} y={a.y} width={a.width} height={a.height} rx={a.rx} />)}
    </Svg>
  );
}

const FLAME_OUT = 'M12 22.5c-4.4 0-7.6-3.1-7.6-7.3 0-3.6 2.4-5.8 4-7.8.4 1.9 1.3 3.2 2.6 3.7-.4-3.2.7-6.4 3.6-8.6-.3 3.5 1.6 5.5 3.2 7.7 1.2 1.6 1.8 3.3 1.8 5.2 0 4.2-3.2 7.1-7.6 7.1z';
const FLAME_IN = 'M12 21.6c-2 0-3.4-1.4-3.4-3.3 0-1.6 1-2.7 2-3.7.2 1 .7 1.6 1.3 1.8.1-1.7.8-3 2.1-3.9 0 1.7.6 2.7 1.1 3.6.3.6.5 1.2.5 2.1 0 1.9-1.6 3.4-3.6 3.4z';
/** Flamme PepsGoal aux couleurs de l'accent ; éteinte (grise) quand `dim`. */
export function Flame({ size = 22, dim = false, colors }: { size?: number; dim?: boolean; colors?: [string, string, string] }) {
  const t = useTheme();
  const [a, b, c] = dim ? (t.dark ? ['#6B6E92', '#555878', '#45475F'] : ['#B5B7CF', '#A0A2BE', '#8D8FAD']) : (colors ?? t.accent);
  // Identifiant propre à chaque flamme : sur le web, un dégradé homonyme situé dans un écran masqué ne s'afficherait pas
  const id = `f${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={{ opacity: dim ? 0.55 : 1 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Defs>
          <SvgGradient id={`${id}o`} x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor={c} /><Stop offset="0.5" stopColor={b} /><Stop offset="1" stopColor={a} /></SvgGradient>
          <SvgGradient id={`${id}i`} x1="0" y1="1" x2="0" y2="0"><Stop offset="0" stopColor={a} /><Stop offset="1" stopColor="#FFF6CC" /></SvgGradient>
        </Defs>
        <Path d={FLAME_OUT} fill={`url(#${id}o)`} />
        <Path d={FLAME_IN} fill={`url(#${id}i)`} opacity={dim ? 0.5 : 1} />
      </Svg>
    </View>
  );
}

export function Logo({ size = 21 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityRole="header" accessibilityLabel="PepsGoal">
      <Flame size={size + 7} />
      <Text style={{ fontFamily: FONT.display, fontSize: size, letterSpacing: -0.5, color: t.ink }}>Peps<Text style={{ color: t.highContrast ? t.ink : t.accent[1] }}>Goal</Text></Text>
    </View>
  );
}

/* ---------- fond : halos colorés sous les panneaux vitrés ---------- */
export function Backdrop() {
  const t = useTheme();
  const { width: w, height: h } = useWindowDimensions();
  if (t.blobOpacity <= 0) return null;
  const vmax = Math.max(w, h) / 100;
  const blobs = [
    { s: 60 * vmax, x: -22 * vmax, y: -24 * vmax, c: t.blobs[0]!, o: 1 },
    { s: 54 * vmax, x: w + 24 * vmax - 54 * vmax, y: h * 0.12, c: t.blobs[1]!, o: 1 },
    { s: 52 * vmax, x: w * 0.1, y: h + 26 * vmax - 52 * vmax, c: t.blobs[2]!, o: 1 },
    { s: 30 * vmax, x: w * 0.4, y: h * 0.02, c: t.blobs[3]!, o: 0.6 }
  ];
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width={w} height={h}>
        <Defs>
          {blobs.map((b, i) => (
            <RadialGradient key={i} id={`blob${i}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={b.c} stopOpacity={t.blobOpacity * b.o} />
              <Stop offset="1" stopColor={b.c} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        {blobs.map((b, i) => <Circle key={i} cx={b.x + b.s / 2} cy={b.y + b.s / 2} r={b.s / 2} fill={`url(#blob${i})`} />)}
      </Svg>
    </View>
  );
}

/* ---------- panneaux ---------- */
export function Glass({ children, style, strong, pad = 20 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; strong?: boolean; pad?: number }) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: strong ? t.glassStrong : t.glassCard, borderColor: t.glassEdge, borderWidth: t.borderWidth, borderRadius: 24, padding: pad, gap: 12 }, shadow(t), style]}>
      {children}
    </View>
  );
}
/** Carte avec titre (et élément à droite : compteur, bouton…), comme `.card` + `.card-h` du web. */
export function Card({ children, title, right, style }: { children?: ReactNode; title?: string; right?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Glass style={style}>
      {(title || right) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          {title ? <Txt v="h2" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Txt> : <View />}
          {typeof right === 'string' || typeof right === 'number' ? <Txt v="bold" color={t.ink2}>{right}</Txt> : right}
        </View>
      )}
      {children}
    </Glass>
  );
}

/* ---------- boutons ---------- */
type BtnKind = 'primary' | 'ghost' | 'plain' | 'danger';
export function Button({ label, onPress, kind = 'primary', busy, disabled, icon, small, block, style }: {
  label: string; onPress: () => void; kind?: BtnKind; busy?: boolean; disabled?: boolean; icon?: IconName | string; small?: boolean; block?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const color = kind === 'primary' ? t.onAccent : kind === 'danger' ? t.danger : kind === 'plain' ? t.ink2 : t.ink;
  const pad = small ? { paddingVertical: 8, paddingHorizontal: 14, minHeight: 38 } : { paddingVertical: 11, paddingHorizontal: 18, minHeight: 46 };
  const content = busy ? <ActivityIndicator color={color} /> : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon ? <Icon name={icon} size={small ? 16 : 18} color={color} /> : null}
      <Text style={{ color, fontFamily: FONT.heavy, fontSize: small ? 13 : 14 }}>{label}</Text>
    </View>
  );
  const frame: ViewStyle = { borderRadius: 999, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', alignSelf: block ? 'stretch' : 'flex-start', ...pad };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!(disabled || busy), busy: !!busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }], alignSelf: block ? 'stretch' : 'flex-start', borderRadius: 999 }, kind === 'primary' && !disabled ? shadowAccent(t) : null, style]}>
      {kind === 'primary' ? (
        <LinearGradient colors={t.accent} locations={[0, 0.5, 1]} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={[frame, t.highContrast ? { borderWidth: 2, borderColor: t.ink } : null]}>{content}</LinearGradient>
      ) : (
        <View style={[frame, kind === 'ghost' ? { backgroundColor: t.glassStrong, borderWidth: t.borderWidth, borderColor: t.line } : kind === 'danger' ? { borderWidth: t.borderWidth, borderColor: alpha(t.danger, 0.45) } : null]}>{content}</View>
      )}
    </Pressable>
  );
}
const shadowAccent = (t: Theme): ViewStyle => t.highContrast ? {} : ({ shadowColor: t.accent[1], shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 6 });

export function IconButton({ icon, label, onPress, size = 42 }: { icon: IconName | string; label: string; onPress: () => void; size?: number }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glassStrong, borderWidth: t.borderWidth, borderColor: t.line, opacity: pressed ? 0.8 : 1 })}>
      <Icon name={icon} size={20} />
    </Pressable>
  );
}

/* ---------- puces ---------- */
export function TypeChip({ type, label }: { type: string; label?: string }) {
  const t = useTheme(), c = t.type(type);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 2, paddingHorizontal: 9, borderRadius: 999, backgroundColor: alpha(c.c, 0.22), alignSelf: 'flex-start' }}>
      <Icon name={TYPE_ICON[type as keyof typeof TYPE_ICON] ?? 'star'} size={13} color={c.ink} stroke={2.2} />
      <Text style={{ color: c.ink, fontFamily: FONT.heavy, fontSize: 12 }}>{label ?? TYPE_LABEL[type as keyof typeof TYPE_LABEL] ?? type}</Text>
    </View>
  );
}
export function Chip({ label, icon, color }: { label: string; icon?: IconName | string; color?: string }) {
  const t = useTheme(), c = color ?? t.ink3;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: alpha(c, 0.18), alignSelf: 'flex-start' }}>
      {icon ? <Icon name={icon} size={13} color={t.ink2} /> : null}
      <Text style={{ color: t.ink2, fontFamily: FONT.heavy, fontSize: 12 }}>{label}</Text>
    </View>
  );
}
/** Filtres horizontaux (`.fchip`) : l'élément choisi passe en encre pleine. */
export function FilterChips<K extends string>({ items, value, onChange }: { items: [K, string][]; value: K; onChange: (k: K) => void }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
      {items.map(([k, l]) => {
        const on = k === value;
        return (
          <Pressable key={k} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => onChange(k)}
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: t.borderWidth, borderColor: on ? t.ink : t.line, backgroundColor: on ? t.ink : t.glassStrong }}>
            <Text style={{ fontFamily: FONT.heavy, fontSize: 13, color: on ? t.bg : t.ink2 }}>{l}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
/** Sélecteur segmenté (`.seg`). */
export function Seg<K extends string>({ items, value, onChange, label }: { items: [K, string][]; value: K; onChange: (k: K) => void; label?: string }) {
  const t = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', padding: 4, borderRadius: 999, backgroundColor: alpha(t.ink, 0.07), borderWidth: t.highContrast ? 2 : 0, borderColor: t.ink }}>
      {items.map(([k, l]) => {
        const on = k === value;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(k)}
            style={[{ flex: 1, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 999, alignItems: 'center' }, on ? [{ backgroundColor: t.glassStrong }, shadow(t)] : null]}>
            <Text style={{ fontFamily: FONT.heavy, fontSize: 13, color: on ? t.ink : t.ink2 }}>{l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- formulaires ---------- */
export function Field(props: TextInputProps & { label: string }) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt v="label">{props.label}</Txt>
      <TextInput placeholderTextColor={t.ink3} {...props} accessibilityLabel={props.label}
        onFocus={e => { setFocus(true); props.onFocus?.(e); }} onBlur={e => { setFocus(false); props.onBlur?.(e); }}
        style={[{ minHeight: 48, borderWidth: t.borderWidth + 0.5, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: FONT.semibold, color: t.ink, borderColor: focus ? t.focus : t.line, backgroundColor: t.glassStrong },
          props.multiline ? { minHeight: 90, textAlignVertical: 'top' } : null]} />
    </View>
  );
}
/** Interrupteur avec titre et explication (`.set-row` + `.switch`). */
export function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} aria-checked={value} accessibilityLabel={label} accessibilityHint={hint}
      onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <View style={{ flex: 1 }}>
        <Txt v="bold">{label}</Txt>
        {!!hint && <Txt v="small">{hint}</Txt>}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: t.accent[1], false: alpha(t.ink, 0.25) }} thumbColor="#FFFFFF" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden />
    </Pressable>
  );
}
/** Ligne de réglage : titre, explication, action à droite. */
export function SetRow({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 180 }}><Txt v="bold">{title}</Txt>{!!hint && <Txt v="small">{hint}</Txt>}</View>
      {children}
    </View>
  );
}

/* ---------- progression ---------- */
export function Bar({ pct, color }: { pct: number; color?: string }) {
  const t = useTheme();
  const w = `${Math.max(0, Math.min(1, pct)) * 100}%` as const;
  return (
    <View style={{ height: 10, borderRadius: 999, backgroundColor: t.track, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}>
      {color ? <View style={{ width: w, height: '100%', borderRadius: 999, backgroundColor: color }} />
        : <LinearGradient colors={t.accent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: w, height: '100%', borderRadius: 999 }} />}
    </View>
  );
}
/** Anneau « validées aujourd'hui » (`.ring`). */
export function Ring({ done, total, size = 108 }: { done: number; total: number; size?: number }) {
  const t = useTheme();
  const r = 42, c = 2 * Math.PI * r, pct = total ? done / total : 0;
  const id = `ring${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View accessibilityRole="image" accessibilityLabel={`${done} sur ${total} validées aujourd'hui`}>
      <Svg width={size} height={size} viewBox="0 0 108 108">
        <Defs>
          <SvgGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={t.accent[0]} /><Stop offset="0.5" stopColor={t.accent[1]} /><Stop offset="1" stopColor={t.accent[2]} />
          </SvgGradient>
        </Defs>
        <Circle cx={54} cy={54} r={r} fill="none" stroke={t.track} strokeWidth={12} />
        {pct > 0 && <Circle cx={54} cy={54} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 54 54)" />}
        <SvgText x={54} y={62} textAnchor="middle" fontFamily={FONT.display} fontSize={22} fill={t.ink}>{`${done}/${total}`}</SvgText>
      </Svg>
    </View>
  );
}

/* ---------- avatar ---------- */
export function Avatar({ user, size = 40 }: { user: { displayName?: string; username?: string; avatar?: Record<string, unknown> | null; role?: string }; size?: number }) {
  // Compte PepsGoal Officiel : la flamme de la marque
  if (user.role === 'official') return <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: '#10102A', borderWidth: 2, borderColor: 'rgba(255,255,255,0.45)' }}><Flame size={size * 0.62} /></View>;
  const a = (user.avatar ?? {}) as { kind?: string; color?: number; emoji?: string; picto?: string; photo?: string };
  const acc = (ACCENTS[Number(a.color) || 0] ?? ACCENTS[0]!).c;
  const name = user.displayName || user.username || '?';
  const ini = name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const inner = a.kind === 'photo' && typeof a.photo === 'string' && /^(https?:|data:image\/)/.test(a.photo)
    ? <Image source={{ uri: a.photo }} style={{ width: size - 4, height: size - 4, borderRadius: size / 2 }} accessibilityIgnoresInvertColors />
    : a.kind === 'emoji' && a.emoji ? <Text style={{ fontSize: size * 0.54 }}>{a.emoji}</Text>
    : a.kind === 'picto' && a.picto && ICONS[a.picto as IconName] ? <Icon name={a.picto} size={size * 0.56} color="#10102A" stroke={2.2} />
    : <Text style={{ fontFamily: FONT.display, fontSize: size * 0.36, color: '#10102A', letterSpacing: -0.5 }}>{ini}</Text>;
  return (
    <LinearGradient colors={acc} locations={[0, 0.55, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.45)', overflow: 'hidden' }}>
      {inner}
    </LinearGradient>
  );
}

/* ---------- série en cours (barre du haut, classement) ---------- */
export function useMyStreak() {
  const { userId, dataVersion } = useSession();
  const [n, setN] = useState(0);
  const [lit, setLit] = useState(false);
  useEffect(() => {
    if (!userId) return;
    const read = () => void store.checkins(ymd(addDays(new Date(), -400))).then(cs => {
      const s = globalStreak(new Set(cs.filter(c => c.userId === userId && !c.pending && c.kind !== 'relapse' && c.kind !== 'use').map(c => c.date)));
      setN(s.n); setLit(s.lit);
    });
    read();
    // Chaque validation locale met à jour la file d'attente : on relit la série aussitôt
    let last = -1;
    return subscribeSync(s => { if (s.pending !== last) { last = s.pending; read(); } });
  }, [userId, dataVersion]);
  return { n, lit };
}

/* ---------- cadre d'écran : barre du haut vitrée + contenu ---------- */
export function Topbar({ title }: { title: string }) {
  const t = useTheme();
  const wide = useWide();
  const { online } = useNetwork();
  const { mode, user } = useSession();
  const { n } = useMyStreak();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 20, paddingRight: 12, borderRadius: 20, backgroundColor: t.glass, borderWidth: t.borderWidth, borderColor: t.glassEdge, minHeight: 62 }, shadow(t), blur(t)]}>
      <View style={{ flex: 1, minWidth: 0 }}>{wide ? <Txt v="title" accessibilityRole="header" numberOfLines={1}>{title}</Txt> : <Logo size={19} />}</View>
      {!online && mode === 'account' && <View accessibilityLabel="Hors ligne"><Icon name="cloudoff" size={20} color={t.type('objective').ink} stroke={2.4} /></View>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityLabel={`Série en cours : ${n} ${n > 1 ? 'jours' : 'jour'}`}>
        <Flame size={22} /><Txt v="bold" style={{ fontSize: 14 }}>{n}</Txt>
      </View>
      {user && typeof (user as { freezes?: number }).freezes === 'number' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessibilityLabel={`${(user as { freezes?: number }).freezes} gels de série`}>
          <Icon name="snow" size={18} color={t.type('objective').ink} stroke={2.4} /><Txt v="bold" color={t.type('objective').ink} style={{ fontSize: 13 }}>{(user as { freezes?: number }).freezes}</Txt>
        </View>
      )}
    </View>
  );
}

/** Bandeau hors ligne / maintenance / mode sans compte (`.demo-note`). */
export function StatusBanner() {
  const t = useTheme();
  const { online, maintenance } = useNetwork();
  const { mode } = useSession();
  let text: string | null = null, icon: IconName = 'cloudoff';
  if (mode === 'account' && !online) text = 'Hors ligne : tes validations sont enregistrées sur cet appareil et seront synchronisées au retour de la connexion. Fonctions sociales et changement de compte suspendus.';
  else if (maintenance) { text = maintenance.mode === 'full' ? `Maintenance en cours. ${maintenance.message}` : 'Maintenance : fonctions sociales en lecture seule.'; icon = 'gauge'; }
  else if (mode === 'guest') { text = 'Sans compte : données sur cet appareil uniquement, sans synchronisation ni fonctions sociales.'; icon = 'lock'; }
  if (!text) return null;
  return (
    <View accessibilityRole="alert" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 16, borderWidth: t.borderWidth, borderStyle: 'dashed', borderColor: t.ink3 }}>
      <Icon name={icon} size={18} color={t.ink2} />
      <Text style={{ flex: 1, color: t.ink2, fontFamily: FONT.semibold, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

/**
 * Écran : barre du haut vitrée (titre sur grand écran, logo sur mobile), bandeaux d'état, contenu sur 900 px max.
 * Sur mobile, une marge basse laisse la place à la barre d'onglets flottante.
 */
export function Screen({ children, title, scroll = true, tabs = true }: { children: ReactNode; title?: string; scroll?: boolean; tabs?: boolean }) {
  const wide = useWide();
  const body = (
    <View style={{ gap: 18, width: '100%', maxWidth: 940, alignSelf: 'center', paddingHorizontal: wide ? 0 : 16, paddingTop: wide ? 20 : 10, paddingBottom: tabs && !wide ? 130 : 40 }}>
      {title !== undefined && <Topbar title={title} />}
      <StatusBanner />
      {children}
    </View>
  );
  return (
    <View style={{ flex: 1 }}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{body}</ScrollView> : body}
    </View>
  );
}

/** Bouton d'action flottant (mobile) : nouvel objectif, nouvelle publication. */
export function Fab({ label, onPress, icon = 'plus' }: { label: string; onPress: () => void; icon?: IconName }) {
  const t = useTheme();
  if (useWide()) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[{ position: 'absolute', right: 20, bottom: 104, width: 58, height: 58, borderRadius: 29 }, shadowAccent(t)]}>
      <LinearGradient colors={t.accent} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={{ flex: 1, borderRadius: 29, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={26} color={t.onAccent} stroke={2.6} />
      </LinearGradient>
    </Pressable>
  );
}

/** État vide (`.empty`). */
export function Empty({ title, text, action }: { title?: string; text: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 26, paddingHorizontal: 12 }}>
      {!!title && <Txt v="h2" style={{ textAlign: 'center' }}>{title}</Txt>}
      <Txt v="muted" style={{ textAlign: 'center' }}>{text}</Txt>
      {action}
    </View>
  );
}

export const go = (path: string) => router.push(path as never);

/* ---------- dialogues : Alert ne fait rien sur le web, on passe alors par le navigateur ---------- */
/** Message d'information. */
export function tell(title: string, text = '') {
  if (isWeb) { globalThis.alert?.(text ? `${title}\n\n${text}` : title); return; }
  Alert.alert(title, text);
}
/** Confirmation avant une action (destructive par défaut). */
export function ask(title: string, text: string, ok: string, run: () => void | Promise<void>, destructive = true) {
  if (isWeb) { if (globalThis.confirm?.(`${title}\n\n${text}`)) void run(); return; }
  Alert.alert(title, text, [{ text: 'Annuler', style: 'cancel' }, { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => void run() }]);
}

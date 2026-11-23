// A generous set of generic icons an owner can put on a button. Only these are bundled into the app.
import {
  Award, Book, Briefcase, Building2, Calendar, Camera, Car, Code, Coffee, CreditCard, Download, Dumbbell, File,
  Gamepad2, Gift, Globe, GraduationCap, Hammer, Headphones, Heart, House, Image, Landmark, Laptop, Link, Mail,
  MapPin, MessageCircle, Mic, Music, Newspaper, Palette, Phone, Plane, Podcast, QrCode, Rss, Scissors, Send,
  Share2, ShoppingBag, Smartphone, Star, Stethoscope, Tag, Truck, User, Users, Utensils, Video, Wallet, Wrench, Clock,
  type LucideIcon,
} from "lucide-react";

export const LUCIDE_ICONS: Record<string, LucideIcon> = {
  mail: Mail, phone: Phone, globe: Globe, "map-pin": MapPin, calendar: Calendar, file: File, download: Download,
  "shopping-bag": ShoppingBag, briefcase: Briefcase, video: Video, music: Music, heart: Heart, star: Star,
  link: Link, "message-circle": MessageCircle, camera: Camera, image: Image, book: Book, coffee: Coffee,
  gift: Gift, house: House, "building-2": Building2, car: Car, plane: Plane, truck: Truck, wrench: Wrench,
  hammer: Hammer, scissors: Scissors, utensils: Utensils, wallet: Wallet, "credit-card": CreditCard, laptop: Laptop,
  smartphone: Smartphone, headphones: Headphones, mic: Mic, newspaper: Newspaper, "graduation-cap": GraduationCap,
  award: Award, users: Users, user: User, clock: Clock, tag: Tag, "qr-code": QrCode, "share-2": Share2, send: Send,
  rss: Rss, podcast: Podcast, "gamepad-2": Gamepad2, palette: Palette, code: Code, stethoscope: Stethoscope,
  dumbbell: Dumbbell, landmark: Landmark,
};

export const LUCIDE_KEYS = Object.keys(LUCIDE_ICONS);

export function LucideByKey({ name, size = 20 }: { name: string; size?: number }) {
  const C = LUCIDE_ICONS[name] ?? Link;
  return <C size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" style={{ flex: "none" }} />;
}

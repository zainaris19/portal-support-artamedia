import React, { useState, useRef } from 'react';
import { Search, Bell, Moon, Sun, LogOut, User, Camera, Trash2, Loader2, Menu } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { APP, AUTH } from '@/constants/testIds';
import { toast } from 'sonner';
import api, { formatApiError } from '@/lib/api';

const ROLE_LABEL = {
  admin: 'Administrator',
  supervisor: 'Supervisor NOC',
  engineer: 'NOC Engineer',
  viewer: 'Viewer',
  teknisi: 'Teknisi Lapangan',
};

const MAX_AVATAR_BYTES = 1_500_000; // 1.5MB pre-compression
const AVATAR_TARGET_PX = 320;      // downscale square target

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Downscale + center-crop to AVATAR_TARGET_PX square, output JPEG data URL.
async function processAvatar(file) {
  const rawDataUrl = await readFileAsDataURL(file);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Gagal membaca gambar'));
    el.src = rawDataUrl;
  });
  const size = AVATAR_TARGET_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Center crop to square
  const short = Math.min(img.width, img.height);
  const sx = (img.width - short) / 2;
  const sy = (img.height - short) / 2;
  ctx.drawImage(img, sx, sy, short, short, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.82);
}

export default function Header({ onSearch, onMobileMenuOpen }) {
  const { theme, toggle } = useTheme();
  const { user, setUser, refreshUser } = useAuth();
  const [q, setQ] = useState('');
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileRef = useRef(null);

  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();
  const hasPhoto = !!user?.avatar_base64;

  const onPickAvatar = () => fileRef.current?.click();

  const onAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('File harus berupa gambar (JPG / PNG / WebP)');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Ukuran file terlalu besar (max 8MB sebelum kompresi)');
      return;
    }
    setUploading(true);
    try {
      const processed = await processAvatar(file);
      if (processed.length > MAX_AVATAR_BYTES) {
        toast.error('Gambar terlalu besar setelah kompresi. Coba gambar lain.');
        return;
      }
      const { data } = await api.post('/auth/me/avatar', { avatar_base64: processed });
      setUser(data);
      toast.success('Foto profil diperbarui');
    } catch (err) {
      toast.error(formatApiError(err));
      refreshUser();
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = async () => {
    setConfirmRemove(false);
    setUploading(true);
    try {
      const { data } = await api.post('/auth/me/avatar', { avatar_base64: null });
      setUser(data);
      toast.success('Foto profil dihapus');
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setUploading(false);
    }
  };

  const { logout } = useAuth();

  return (
    <header className="h-14 shrink-0 border-b border-border bg-card flex items-center px-3 md:px-4 gap-2 md:gap-3">
      {/* Mobile hamburger — visible only on <md */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onMobileMenuOpen}
        className="md:hidden h-9 w-9 shrink-0"
        aria-label="Buka menu"
        data-testid="mobile-menu-button"
      >
        <Menu className="w-5 h-5" />
      </Button>

      <div className="flex-1 min-w-0 max-w-xl relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          data-testid={APP.globalSearch}
          value={q}
          onChange={(e) => { setQ(e.target.value); onSearch?.(e.target.value); }}
          placeholder="Cari…"
          className="pl-9 h-9 bg-background border-border text-sm"
        />
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onAvatarChange}
        data-testid="avatar-file-input"
      />

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          data-testid={APP.themeToggle}
          onClick={toggle}
          aria-label="Toggle theme"
          className="h-9 w-9"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>

        <Button variant="ghost" size="icon" data-testid={APP.notifBell} className="h-9 w-9 relative" aria-label="Notifications">
          <Bell className="w-4 h-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-primary" />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button data-testid={APP.userMenu} className="flex items-center gap-2 pl-1.5 pr-3 h-9 rounded-md hover:bg-accent transition-colors">
              <div
                data-testid="user-avatar"
                className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary/30 bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold ring-2 ring-primary/5 shadow-sm"
              >
                {hasPhoto ? (
                  <img src={user.avatar_base64} alt={user?.name || 'user'} className="w-full h-full object-cover" />
                ) : (
                  <span>{initial}</span>
                )}
              </div>
              <div className="hidden sm:block text-left leading-tight">
                <div className="text-xs font-semibold text-foreground">{user?.name}</div>
                <div className="text-[10px] text-muted-foreground">{ROLE_LABEL[user?.role] || user?.role}</div>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full overflow-hidden border-2 border-primary/30 bg-primary/10 flex items-center justify-center text-primary text-base font-bold shrink-0">
                  {hasPhoto ? (
                    <img src={user.avatar_base64} alt={user?.name || 'user'} className="w-full h-full object-cover" />
                  ) : (
                    <span>{initial}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{user?.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{user?.email}</div>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-xs">
              <User className="w-3.5 h-3.5 mr-2" /> {ROLE_LABEL[user?.role] || user?.role}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => { e.preventDefault(); onPickAvatar(); }}
              disabled={uploading}
              data-testid="avatar-upload-button"
              className="cursor-pointer"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <Camera className="w-3.5 h-3.5 mr-2" />
              )}
              {hasPhoto ? 'Ganti foto profil' : 'Upload foto profil'}
            </DropdownMenuItem>
            {hasPhoto && (
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setConfirmRemove(true); }}
                disabled={uploading}
                data-testid="avatar-remove-button"
                className="cursor-pointer text-rose-600 dark:text-rose-400 focus:text-rose-700"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" /> Hapus foto profil
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem data-testid={AUTH.logoutBtn} onClick={logout} className="text-rose-600 dark:text-rose-400 focus:text-rose-700 cursor-pointer">
              <LogOut className="w-3.5 h-3.5 mr-2" /> Keluar
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus foto profil?</AlertDialogTitle>
            <AlertDialogDescription>Avatar akan kembali ke inisial nama Anda.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeAvatar}
              data-testid="avatar-remove-confirm"
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
}

import { useEffect } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { HomePage } from "@/pages/HomePage";
import { GalleryPage } from "@/features/flyers/pages/GalleryPage";
import { FlyerDetailPage } from "@/features/flyers/pages/FlyerDetailPage";
import { PetMapPage } from "@/pages/PetMapPage";
import { BuilderWizard } from "@/features/flyers/pages/BuilderWizard";
import { MyFlyersPage } from "@/features/flyers/pages/MyFlyersPage";
import { LoginPage } from "@/features/auth/pages/LoginPage";
import { RegisterPage } from "@/features/auth/pages/RegisterPage";
import { SettingsPage } from "@/features/auth/pages/SettingsPage";
import { RewardSuccessPage } from "@/features/rewards/pages/RewardSuccessPage";
import { RewardCancelPage } from "@/features/rewards/pages/RewardCancelPage";
import { useAuth } from "@/stores/auth";

export function App() {
  const fetchMe = useAuth((s) => s.fetchMe);
  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="flyers" element={<GalleryPage />} />
        <Route path="flyers/:id" element={<FlyerDetailPage />} />
        <Route path="map" element={<PetMapPage />} />
        <Route path="builder" element={<BuilderWizard />} />
        <Route path="my-flyers" element={<MyFlyersPage />} />
        <Route path="auth/login" element={<LoginPage />} />
        <Route path="auth/register" element={<RegisterPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="rewards/success" element={<RewardSuccessPage />} />
        <Route path="rewards/cancel" element={<RewardCancelPage />} />
      </Route>
    </Routes>
  );
}

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ThemeManager extends ChangeNotifier {
  static const String _themeKey = 'theme_mode';
  ThemeMode _themeMode = ThemeMode.system;

  ThemeMode get themeMode => _themeMode;

  // 저장된 테마 설정 불러오기
  Future<void> loadTheme() async {
    final prefs = await SharedPreferences.getInstance();
    final themeIndex = prefs.getInt(_themeKey);

    if (themeIndex != null) {
      _themeMode = ThemeMode.values[themeIndex];
      notifyListeners();
    }
  }

  // 테마 설정 저장하기
  Future<void> saveTheme(ThemeMode themeMode) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_themeKey, themeMode.index);

    _themeMode = themeMode;
    notifyListeners();
  }

  // 라이트 모드로 설정
  Future<void> setLightMode() async {
    await saveTheme(ThemeMode.light);
  }

  // 다크 모드로 설정
  Future<void> setDarkMode() async {
    await saveTheme(ThemeMode.dark);
  }

  // 시스템 설정에 따라 설정
  Future<void> setSystemMode() async {
    await saveTheme(ThemeMode.system);
  }

  // 다음 테마로 순환
  Future<void> cycleTheme() async {
    switch (_themeMode) {
      case ThemeMode.light:
        await setDarkMode();
        break;
      case ThemeMode.dark:
        await setSystemMode();
        break;
      case ThemeMode.system:
        await setLightMode();
        break;
    }
  }

  // 현재 테마가 라이트 모드인지 확인
  bool get isLightMode => _themeMode == ThemeMode.light;

  // 현재 테마가 다크 모드인지 확인
  bool get isDarkMode => _themeMode == ThemeMode.dark;

  // 현재 테마가 시스템 모드인지 확인
  bool get isSystemMode => _themeMode == ThemeMode.system;
}

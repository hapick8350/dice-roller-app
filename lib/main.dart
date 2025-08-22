import 'package:flutter/material.dart';
import 'dart:math';
import 'package:provider/provider.dart';
import 'theme_manager.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  final themeManager = ThemeManager();
  await themeManager.loadTheme();

  runApp(
    ChangeNotifierProvider(
      create: (_) => themeManager,
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<ThemeManager>(
      builder: (context, themeManager, child) {
        return MaterialApp(
          title: '주사위 굴리기',
          themeMode: themeManager.themeMode,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF6366F1),
              brightness: Brightness.light,
            ),
            useMaterial3: true,
            fontFamily: 'Pretendard',
          ),
          darkTheme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF6366F1),
              brightness: Brightness.dark,
            ),
            useMaterial3: true,
            fontFamily: 'Pretendard',
          ),
          home: const DicePage(),
        );
      },
    );
  }
}

class DicePage extends StatefulWidget {
  const DicePage({super.key});

  @override
  State<DicePage> createState() => _DicePageState();
}

class _DicePageState extends State<DicePage> with TickerProviderStateMixin {
  int _diceNumber = 1;
  final Random _random = Random();

  late AnimationController _physicsController;
  late Animation<double> _positionXAnimation;
  late Animation<double> _positionYAnimation;
  late Animation<double> _rotationAnimation;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();

    // 물리 애니메이션 컨트롤러
    _physicsController = AnimationController(
      duration: const Duration(milliseconds: 2500),
      vsync: this,
    );

    // 초기 애니메이션 설정
    _initializeAnimations();
  }

  void _initializeAnimations() {
    // X축 위치 애니메이션 (좌우 움직임)
    _positionXAnimation = Tween<double>(
      begin: 0.0,
      end: 0.0,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.easeOut,
    ));

    // Y축 위치 애니메이션 (중력 효과)
    _positionYAnimation = Tween<double>(
      begin: 0.0,
      end: 0.0,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.bounceOut,
    ));

    // 회전 애니메이션 (각속도)
    _rotationAnimation = Tween<double>(
      begin: 0.0,
      end: 0.0,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.easeOut,
    ));

    // 크기 변화 애니메이션 (압축 효과)
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.elasticOut,
    ));
  }

  Widget _buildDiceDots(int number) {
    List<Widget> dots = [];

    switch (number) {
      case 1:
        dots = [
          _buildDot(Alignment.center),
        ];
        break;
      case 2:
        dots = [
          _buildDot(const Alignment(-0.5, -0.5)),
          _buildDot(const Alignment(0.5, 0.5)),
        ];
        break;
      case 3:
        dots = [
          _buildDot(const Alignment(-0.5, -0.5)),
          _buildDot(Alignment.center),
          _buildDot(const Alignment(0.5, 0.5)),
        ];
        break;
      case 4:
        dots = [
          _buildDot(const Alignment(-0.5, -0.5)),
          _buildDot(const Alignment(0.5, -0.5)),
          _buildDot(const Alignment(-0.5, 0.5)),
          _buildDot(const Alignment(0.5, 0.5)),
        ];
        break;
      case 5:
        dots = [
          _buildDot(const Alignment(-0.5, -0.5)),
          _buildDot(const Alignment(0.5, -0.5)),
          _buildDot(Alignment.center),
          _buildDot(const Alignment(-0.5, 0.5)),
          _buildDot(const Alignment(0.5, 0.5)),
        ];
        break;
      case 6:
        dots = [
          _buildDot(const Alignment(-0.5, -0.5)),
          _buildDot(const Alignment(0.5, -0.5)),
          _buildDot(const Alignment(-0.5, 0.0)),
          _buildDot(const Alignment(0.5, 0.0)),
          _buildDot(const Alignment(-0.5, 0.5)),
          _buildDot(const Alignment(0.5, 0.5)),
        ];
        break;
    }

    return Stack(
      children: dots,
    );
  }

  Widget _buildDot(Alignment alignment) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Align(
      alignment: alignment,
      child: Container(
        width: 24,
        height: 24,
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF1E293B) : Colors.white,
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.1),
              spreadRadius: 0,
              blurRadius: 4,
              offset: const Offset(0, 2),
            ),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _physicsController.dispose();
    super.dispose();
  }

  void _rollDice() async {
    // 초기 물리 상태 설정
    double initialVelocityX = (_random.nextDouble() - 0.5) * 150; // 랜덤한 초기 속도
    double initialVelocityY = 120; // 아래로 떨어지는 속도
    double initialAngularVelocity =
        (_random.nextDouble() - 0.5) * 15; // 랜덤한 각속도

    // X축 움직임 (마찰력으로 감속)
    _positionXAnimation = Tween<double>(
      begin: 0.0,
      end: initialVelocityX,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.easeOut,
    ));

    // Y축 중력 시뮬레이션 (위에서 아래로 떨어지면서 바운스)
    _positionYAnimation = Tween<double>(
      begin: -50.0, // 시작 위치를 위로
      end: initialVelocityY,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.bounceOut,
    ));

    // 회전 시뮬레이션
    _rotationAnimation = Tween<double>(
      begin: 0.0,
      end: initialAngularVelocity * pi,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.easeOut,
    ));

    // 크기 변화 (압축 효과)
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 1.3,
    ).animate(CurvedAnimation(
      parent: _physicsController,
      curve: Curves.elasticOut,
    ));

    // 애니메이션 시작
    _physicsController.forward();

    // 애니메이션 중간에 숫자 변경
    await Future.delayed(const Duration(milliseconds: 1000));

    setState(() {
      _diceNumber = _random.nextInt(6) + 1;
    });

    // 애니메이션 완료 후 리셋
    await Future.delayed(const Duration(milliseconds: 1500));
    _physicsController.reset();
    _initializeAnimations(); // 애니메이션 재초기화
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor:
          isDark ? const Color(0xFF1A1A1A) : const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          '🎲 주사위 굴리기',
          style: TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 24,
          ),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: true,
        actions: [
          Consumer<ThemeManager>(
            builder: (context, themeManager, child) {
              return IconButton(
                onPressed: () => themeManager.cycleTheme(),
                icon: Icon(
                  themeManager.isLightMode
                      ? Icons.light_mode
                      : themeManager.isDarkMode
                          ? Icons.dark_mode
                          : Icons.brightness_auto,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
                tooltip: '테마 변경',
              );
            },
          ),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: isDark
                ? [
                    const Color(0xFF1A1A1A),
                    const Color(0xFF2D2D2D),
                  ]
                : [
                    const Color(0xFFF8FAFC),
                    const Color(0xFFE2E8F0),
                  ],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // 제목
                Text(
                  '주사위를 굴려보세요',
                  style: TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w600,
                    color: isDark ? Colors.white : const Color(0xFF1E293B),
                    letterSpacing: -0.5,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '버튼을 눌러서 무작위 숫자를 확인하세요',
                  style: TextStyle(
                    fontSize: 16,
                    color: isDark ? Colors.grey[300] : const Color(0xFF64748B),
                    fontWeight: FontWeight.w400,
                  ),
                ),
                const SizedBox(height: 60),

                // 주사위
                AnimatedBuilder(
                  animation: _physicsController,
                  builder: (context, child) {
                    return Transform.translate(
                      offset: Offset(
                          _positionXAnimation.value, _positionYAnimation.value),
                      child: Transform.scale(
                        scale: _scaleAnimation.value,
                        child: Transform.rotate(
                          angle: _rotationAnimation.value,
                          child: Container(
                            width: 220,
                            height: 220,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: isDark
                                    ? [
                                        const Color(0xFFFFFFFF),
                                        const Color(0xFFF1F5F9),
                                      ]
                                    : [
                                        const Color(0xFF2D2D2D),
                                        const Color(0xFF1A1A1A),
                                      ],
                              ),
                              borderRadius: BorderRadius.circular(24),
                              border: Border.all(
                                color: isDark
                                    ? const Color(0xFFE2E8F0)
                                    : Colors.grey[700]!,
                                width: 2,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: const Color(0xFF6366F1)
                                      .withValues(alpha: 0.1),
                                  spreadRadius: 0,
                                  blurRadius: 20,
                                  offset: const Offset(0, 8),
                                ),
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.05),
                                  spreadRadius: 0,
                                  blurRadius: 40,
                                  offset: const Offset(0, 16),
                                ),
                              ],
                            ),
                            child: _buildDiceDots(_diceNumber),
                          ),
                        ),
                      ),
                    );
                  },
                ),

                const SizedBox(height: 60),

                // 버튼
                Container(
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF6366F1).withValues(alpha: 0.3),
                        spreadRadius: 0,
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: ElevatedButton(
                    onPressed: _rollDice,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF6366F1),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 48,
                        vertical: 20,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                      elevation: 0,
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.casino,
                          size: 24,
                          color: Colors.white,
                        ),
                        SizedBox(width: 12),
                        Text(
                          '주사위 굴리기',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 40),

                // 현재 숫자 표시
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: isDark ? const Color(0xFF2D2D2D) : Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color:
                          isDark ? Colors.grey[700]! : const Color(0xFFE2E8F0),
                      width: 1,
                    ),
                  ),
                  child: Text(
                    '현재 숫자: $_diceNumber',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color:
                          isDark ? Colors.grey[300] : const Color(0xFF64748B),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

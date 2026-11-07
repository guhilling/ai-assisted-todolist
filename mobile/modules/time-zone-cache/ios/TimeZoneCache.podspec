Pod::Spec.new do |s|
  s.name           = 'TimeZoneCache'
  s.version        = '1.0.0'
  s.summary        = 'Drops the time zone Hermes cached (#526)'
  s.author         = 'TaskFest'
  s.homepage       = 'https://github.com/guhilling/ai-assisted-todolist'
  s.license        = 'Apache-2.0'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-jsi'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20' }
  s.source_files = '**/*.{h,mm,swift}'
end

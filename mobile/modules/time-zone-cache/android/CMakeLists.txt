cmake_minimum_required(VERSION 3.13)
project(timezonecache)
set(CMAKE_CXX_STANDARD 20)

find_package(ReactAndroid REQUIRED CONFIG)
add_library(timezonecache SHARED src/main/cpp/reset.cpp)
target_link_libraries(timezonecache ReactAndroid::jsi)

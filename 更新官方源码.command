#!/bin/zsh

set -e

project_directory=${0:A:h}

echo "正在检查 DeepSeek Harness 官方更新……"
git -C "$project_directory" submodule update --init --remote --checkout upstream

echo
echo "官方源码已同步完成。"
echo "按任意键关闭窗口。"
read -k 1

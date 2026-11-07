#include <functional>
#include <iostream>
#include <queue>
#include <vector>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    long long lead;
    if (!(cin >> n >> lead)) return 0;

    priority_queue<int, vector<int>, greater<int>> wins;
    long long total = 0, won = 0;
    int answer = n + 1;
    for (int i = 0; i < n; ++i) {
        int points;
        cin >> points;
        total += points;
        wins.push(points);
        won += points;

        // 若已经有 r 局可行，今后只需检验不超过 r 局的方案。
        // 对固定胜局数，选取当前前缀中分数最大的几局最有利。
        while (static_cast<int>(wins.size()) > answer) {
            won -= wins.top();
            wins.pop();
        }
        while (!wins.empty() && 2 * (won - wins.top()) >= total + lead) {
            won -= wins.top();
            wins.pop();
        }
        if (2 * won >= total + lead) answer = static_cast<int>(wins.size());
    }

    cout << (answer <= n ? answer : -1) << '\n';
    return 0;
}

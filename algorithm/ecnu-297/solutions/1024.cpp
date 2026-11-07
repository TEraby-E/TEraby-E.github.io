#include <algorithm>
#include <iostream>
#include <string>
#include <vector>

using namespace std;

int main() {
    string s;
    if (!(cin >> s)) return 0;

    int n = static_cast<int>(s.size());
    vector<int> pieces(n + 1);
    for (int i = 0; i <= n; ++i) pieces[i] = i;

    // 中心按从左到右处理。更新右端点时，左端点之前的最优解已经确定。
    for (int center = 0; center < n; ++center) {
        for (int offset = 0; offset <= 1; ++offset) {
            for (int left = center, right = center + offset;
                 left >= 0 && right < n && s[left] == s[right];
                 --left, ++right) {
                pieces[right + 1] = min(pieces[right + 1], pieces[left] + 1);
            }
        }
    }
    cout << pieces[n] - 1 << '\n';
}
